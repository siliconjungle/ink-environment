import {test} from 'node:test';import assert from 'node:assert/strict';
import {highlightCode,tokenize,formatInk,formatJSON} from '../src/ink-syntax.mjs';
import {examples} from '../src/examples.ts';
const meaningful=s=>tokenize(s).filter(t=>t.kind!=='space').map(t=>[t.kind,t.text]);
test('Ink tokens cover adaptive declarations, contracts, queries, operators and precise numbers',()=>{
 const source=`trainable state Model:List<f64> = [1e-12f64, 0xFF, 1_000];\nadaptive fn f<T>(x:T)->T { return x; }\nlearn change fit() -> Result<Unit,String> writes(Model) ensures(true, "<safe>") { return Ok(()); }\nprotocol preflight; proof by calc { _ == x by provided; }\n// from 123\n/* \'quoted\' */\nlist<u32>{from x in xs; semi join y in ys on x==y; select x & 3 | ~4 ^ 2;}\n`;
 const html=highlightCode(source);for(const k of ['trainable','adaptive','learn','ensures','semi','join','select','protocol','preflight','proof','calc','provided'])assert.ok(html.includes(`class="tok-keyword">${k}</span>`),k);
 for(const n of ['1e-12f64','0xFF','1_000'])assert.ok(html.includes(`class="tok-number">${n}</span>`),n);
 assert.ok(html.includes('class="tok-constant">Ok</span>'));assert.ok(html.includes('class="tok-function">f</span>'));
 assert.ok(!html.includes('<safe>'));assert.ok(html.includes('&lt;safe&gt;'));assert.ok(html.includes('class="tok-comment">// from 123</span>'));
 assert.equal(tokenize(source).map(t=>t.text).join(''),source);
});
test('all shipped source examples format idempotently without changing tokens',()=>{
 for(const e of examples){const formatted=formatInk(e.source);assert.deepEqual(meaningful(formatted),meaningful(e.source),e.id);assert.equal(formatInk(formatted),formatted,e.id);assert.ok(formatted.endsWith('\n'));}
});
test('source formatting preserves string and comment spelling, generic nesting and bitwise syntax',()=>{
 for(const s of ['module x;fn f(xs:List<List<u32>>)->u32{return 2 & ~1;}','module x;state X:u32=0;query f()->Bool reads(X){return X<3;}','module x;fn f()->String{return "<img>\\n x";} // trailing  ', 'module x;/* a\n\n\n b */fn f()->u32{return 1;}']){
  assert.deepEqual(meaningful(formatInk(s)),meaningful(s));assert.equal(formatInk(formatInk(s)),formatInk(s));
 }
 assert.throws(()=>formatInk('module x; fn f('));assert.throws(()=>formatInk('/* unfinished'));
});
test('JSON layout retains exact number/string/key tokens and wraps long arrays',()=>{
 const text='{"wide":18446744073709551615,"float":-0.0,"huge":1e10000,"wide":9007199254740993,"s":"<script>\\u0061","xs":['+Array.from({length:300},(_,i)=>String(i)).join(',')+']}';
 const formatted=formatJSON(text);assert.deepEqual(tokenize(formatted,'json').filter(t=>t.kind!=='space').map(t=>t.text),tokenize(text,'json').filter(t=>t.kind!=='space').map(t=>t.text));
 assert.equal(formatJSON(formatted),formatted);assert.ok(formatted.split('\n').length<80);assert.ok(highlightCode(formatted,'json').includes('class="tok-property">&quot;wide&quot;</span>'));
 for(const e of examples)assert.equal(formatJSON(formatJSON(e.input)),formatJSON(e.input),e.id);
});
test('JSON format errors leave invalid syntax unaccepted',()=>{
 for(const s of ['[1,]','{"x":1,}','{unquoted:1}','01','1e','1e+','[1 2]','[NaN]','"unfinished','[\u00a01]'])assert.throws(()=>formatJSON(s),s);
});
