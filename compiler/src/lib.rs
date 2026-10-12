//! Browser transport around Ink's existing checker and literal target lowerings.
//! No source evaluator is used to execute programs here.
use ink_core::{core::CheckedModule, eval, syntax};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const MAX_REQUEST: usize = 8 * 1024 * 1024;
const MAX_SOURCE: usize = 128 * 1024;
const MAX_INPUT: usize = 1024 * 1024;
static RESPONSE: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn text<'a>(request: &'a Value, name: &str) -> Result<&'a str, String> {
    request[name]
        .as_str()
        .ok_or_else(|| format!("missing {name}"))
}
fn arguments(
    input: &Value,
    params: &[(String, syntax::Type)],
    program: &syntax::Program,
) -> Result<Value, String> {
    let xs = input.as_array().ok_or("Arguments must be a JSON array.")?;
    if xs.len() != params.len() {
        return Err(format!(
            "Expected {} arguments; received {}.",
            params.len(),
            xs.len()
        ));
    }
    xs.iter()
        .zip(params)
        .map(|(value, (name, ty))| {
            eval::Value::from_program_json(value, ty, program)
                .map(|v| v.json())
                .map_err(|e| format!("Argument {name}: {e}"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

pub fn handle(request: &Value) -> Result<Value, String> {
    match text(request, "op")? {
        "compile" => {
            let source = text(request, "source")?;
            if source.len() > MAX_SOURCE {
                return Err("Source exceeds 128 KiB.".into());
            }
            let program = syntax::parse(source)?;
            let checked = CheckedModule::from_source(program)?;
            let emission = ink_lowering_js::lower(&checked)?;
            if emission.javascript.len() > MAX_REQUEST {
                return Err("Generated JavaScript exceeds 8 MiB.".into());
            }
            let bundle = (|| -> Result<Value, String> {
                let p = checked.pure_program()?;
                let c = ink_lowering_c::compute::emit_c(p)?;
                let mut gpu = ink_lowering_gpu::compute::lower(&checked)?;
                gpu.manifest["javascript"] = emission.manifest.clone();
                gpu.manifest["javascript_sha256"] = json!(format!(
                    "{:x}",
                    Sha256::digest(emission.javascript.as_bytes())
                ));
                gpu.manifest["cpu_c_sha256"] = json!(format!("{:x}", Sha256::digest(c.as_bytes())));
                gpu.manifest["runtime_abi"] = json!("ink-packed-pipeline-v2");
                gpu.manifest["destination_abi"] = json!({"name":"ink-packed-into-v1","symbol":"ink_compute_into","count":"words32","ownership":"caller-owned","capacity":"trusted","alignment":8,"aliasing":"destination-disjoint-from-all-reachable-inputs","scratch_lifetime":"call-mark-rewind","prepared_instance":"exclusive"});
                let wasm = ink_lowering_wasm::lower_with_abi(&checked, true)?;
                Ok(
                    json!({"manifest":gpu.manifest,"shaders":gpu.shaders,"c":c,"exports":wasm.exports}),
                )
            })();
            let (bundle, reason) = match bundle {
                Ok(v) => (v, Value::Null),
                Err(e) => (Value::Null, json!(e)),
            };
            Ok(
                json!({"bundle":bundle,"host_reason":reason,"javascript":emission.javascript,"manifest":emission.manifest,
                "core":String::from_utf8(checked.bytes()?).map_err(|e|e.to_string())?}),
            )
        }
        "prepare" => {
            let core = text(request, "core")?;
            let checked = CheckedModule::from_bytes(core.as_bytes())?;
            if checked.identity()? != text(request, "identity")? {
                return Err("Compiled program identity mismatch.".into());
            }
            let program = checked.program();
            let input = text(request, "input")?;
            if input.len() > MAX_INPUT {
                return Err("Input exceeds 1 MiB.".into());
            }
            let input: Value =
                serde_json::from_str(input).map_err(|e| format!("Invalid input JSON: {e}"))?;
            let entry = text(request, "entry")?;
            let prepared = if entry == "@pipeline" {
                let steps = input["steps"].as_array().ok_or("Pipeline needs steps.")?;
                if steps.is_empty() || steps.len() > 8 {
                    return Err("The editor supports 1..8 pipeline steps.".into());
                }
                if input.get("feedback").is_some() || input.get("iterations").is_some() {
                    return Err("The editor accepts a single-pass pipeline. Use the runtime API for feedback.".into());
                }
                let mut types = std::collections::BTreeMap::new();
                let mut canonical = input.clone();
                for (i, step) in steps.iter().enumerate() {
                    let id = step["id"].as_str().ok_or("Step needs an id.")?;
                    if id.is_empty() || types.contains_key(id) {
                        return Err("Invalid or duplicate step id.".into());
                    }
                    let name = step["call"].as_str().ok_or("Step needs a call.")?;
                    let f = program
                        .functions
                        .iter()
                        .find(|f| f.name == name)
                        .ok_or("Unknown pipeline function.")?;
                    let args = step["args"]
                        .as_array()
                        .ok_or("Step args must be an array.")?;
                    if args.len() != f.params.len() {
                        return Err("Pipeline argument count mismatch.".into());
                    }
                    for (j, (arg, (_, ty))) in args.iter().zip(&f.params).enumerate() {
                        if let Some(previous) = arg.get("step").and_then(Value::as_str) {
                            if arg.as_object().map(|x| x.len()) != Some(1)
                                || types.get(previous) != Some(ty)
                            {
                                return Err("Pipeline reference has wrong type or does not name an earlier step.".into());
                            }
                        } else {
                            let value = if let Some(port) = arg.get("input").and_then(Value::as_str)
                            {
                                if arg.as_object().map(|x| x.len()) != Some(1) {
                                    return Err("Invalid input reference.".into());
                                }
                                input["inputs"].get(port).ok_or("Missing pipeline input.")?
                            } else {
                                arg
                            };
                            let value = eval::Value::from_program_json(value, ty, program)?.json();
                            canonical["steps"][i]["args"][j] = value;
                        }
                    }
                    types.insert(id.to_string(), f.result.clone());
                }
                canonical.as_object_mut().unwrap().remove("inputs");
                if let Some(outputs) = input.get("outputs") {
                    let outputs = outputs
                        .as_array()
                        .ok_or("Pipeline outputs must be an array.")?;
                    if outputs.is_empty()
                        || outputs
                            .iter()
                            .any(|v| v.as_str().map(|n| !types.contains_key(n)).unwrap_or(true))
                    {
                        return Err("Unknown pipeline output.".into());
                    }
                }
                canonical
            } else if entry == "@script" {
                let commands = input
                    .as_array()
                    .ok_or("A state script must be a JSON array of {call, args} commands.")?;
                if commands.len() > 256 {
                    return Err("A script may contain at most 256 commands.".into());
                }
                let mut result = Vec::new();
                for (index, command) in commands.iter().enumerate() {
                    let name = command["call"]
                        .as_str()
                        .ok_or_else(|| format!("Command {} needs a call name.", index + 1))?;
                    let action = program
                        .actions
                        .iter()
                        .find(|a| a.name == name)
                        .ok_or_else(|| format!("Unknown query/change: {name}"))?;
                    let args = arguments(&command["args"], &action.params, program)
                        .map_err(|e| format!("Command {}: {e}", index + 1))?;
                    result.push(json!({"call":name,"args":args}));
                }
                Value::Array(result)
            } else {
                let function = program
                    .functions
                    .iter()
                    .find(|f| f.name == entry)
                    .ok_or_else(|| format!("Unknown function: {entry}"))?;
                if ink_core::local_collections::owned(&function.result, program)
                    || function
                        .params
                        .iter()
                        .any(|(_, t)| ink_core::local_collections::owned(t, program))
                {
                    return Err("Owned Buffer/Map helpers are internal to the program.".into());
                }
                arguments(&input, &function.params, program)?
            };
            Ok(json!({"input":serde_json::to_string(&prepared).map_err(|e|e.to_string())?}))
        }
        _ => Err("Unknown compiler request.".into()),
    }
}

#[no_mangle]
pub extern "C" fn ink_env_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_REQUEST {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}
/// Only pointers allocated by ink_env_alloc, with their original length, are valid.
#[no_mangle]
pub unsafe extern "C" fn ink_env_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 && len <= MAX_REQUEST {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}
#[no_mangle]
pub unsafe extern "C" fn ink_env_request(ptr: *const u8, len: usize) -> *const u8 {
    let outcome = if ptr.is_null() || len == 0 || len > MAX_REQUEST {
        Err("Invalid request size.".into())
    } else {
        serde_json::from_slice(std::slice::from_raw_parts(ptr, len))
            .map_err(|e| format!("Invalid compiler request: {e}"))
            .and_then(|request| handle(&request))
    };
    let wire = match outcome {
        Ok(value) => json!({"ok":value}),
        Err(error) => json!({"error":error}),
    };
    let mut response = RESPONSE.lock().unwrap();
    *response = serde_json::to_vec(&wire).unwrap();
    response.as_ptr()
}
#[no_mangle]
pub extern "C" fn ink_env_response_len() -> usize {
    RESPONSE.lock().unwrap().len()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn compile(source: &str) -> Value {
        handle(&json!({"op":"compile","source":source})).unwrap()
    }
    fn prepare(compiled: &Value, entry: &str, input: &str) -> Result<Value, String> {
        handle(
            &json!({"op":"prepare","core":compiled["core"],"identity":compiled["manifest"]["core_sha256"],"entry":entry,"input":input}),
        )
    }
    #[test]
    fn compiler_checks_types_and_rejects_unlinked_source() {
        assert!(
            handle(&json!({"op":"compile","source":"module bad; fn f()->u32{return true;}"}))
                .is_err()
        );
        assert!(handle(
            &json!({"op":"compile","source":"module app; import \"std:words\" as words;"})
        )
        .is_err());
        let c=compile("module generic;fn identity<T>(x:T)->T{return x;} fn run(x:u32)->u32{return identity<u32>(x);}");
        assert!(c["javascript"].as_str().unwrap().contains("export"));
    }
    #[test]
    fn trusted_generated_calls_receive_checked_exact_values() {
        let c =
            compile("module exact;fn word(x:u64)->u64{return x;}fn small(x:u32)->u32{return x;}");
        assert_eq!(
            prepare(&c, "word", "[18446744073709551615]").unwrap()["input"],
            "[18446744073709551615]"
        );
        for input in ["[-1]", "[18446744073709551616]", "[]", "[1,2]", "[true]"] {
            assert!(prepare(&c, "word", input).is_err(), "{input}");
        }
        assert!(prepare(&c, "small", "[4294967296]").is_err());
    }
    #[test]
    fn scripts_validate_every_command_without_executing_it() {
        let c=compile("module stateful;state Rows:Table<u64,u64>=Table.empty();query get(k:u64)->Option<u64> reads(Rows){return Rows.get(k);}");
        assert!(prepare(&c, "@script", r#"[{"call":"get","args":[7]}]"#).is_ok());
        assert!(prepare(
            &c,
            "@script",
            r#"[{"call":"get","args":[7]},{"call":"get","args":[-1]}]"#
        )
        .is_err());
        assert!(prepare(&c, "@script", r#"[{"call":"missing","args":[]}]"#).is_err());
    }
}
