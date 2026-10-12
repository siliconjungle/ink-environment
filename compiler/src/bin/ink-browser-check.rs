//! Native adapter for testing the exact browser compiler request protocol.
use serde_json::{json, Value};
fn main() {
    let result = serde_json::from_reader::<_, Value>(std::io::stdin())
        .map_err(|e| e.to_string())
        .and_then(|request| ink_browser_compiler::handle(&request));
    match result {
        Ok(value) => println!("{}", json!({"ok": value})),
        Err(error) => {
            println!("{}", json!({"error": error}));
            std::process::exit(1);
        }
    }
}
