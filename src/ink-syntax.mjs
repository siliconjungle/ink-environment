// Shared, tolerant Ink presentation lexer. It never parses or executes a program.
export const inkKeywords = new Set(`module import as pub private abstract refined protocol assume decreases invariant spec id record enum type const fn partial let var return if else match for in while limit state trainable adaptive learn frozen event keep change query reads writes emits emit requires ensures before result where law theorem assuming given by rewrite from to proof implementation representation abstraction initialise initialize step observe certificate normalize arithmetic induction cases intro exact apply list exists join semi anti on select approximates within absolute relative ulps sorted unique distinct order unordered preserves using generalizing then exactly forall exists`.split(/\s+/));
const types=new Set('Unit Bool Int Nat String Bytes Option Result List Array Set Map Table Buffer Prop Proof u8 u16 u32 u64 i8 i16 i32 i64 f32 f64'.split(' '));
const constants=new Set(['true','false','None','Some','Ok','Err','null','_']);
const jsKeywords=new Set('import from export const let var return if else new await async function throw try catch finally typeof instanceof for of in while class extends switch case break default void null true false'.split(' '));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function tokenize(text,language='ink') {
 const out=[];let i=0;const add=(kind,end)=>{out.push({kind,text:text.slice(i,end),start:i,end});i=end;};
 const numeric=language==='json'?/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y:/(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?)(?:f(?:32|64)|[ui](?:8|16|32|64)|n)?/y;
 while(i<text.length){const c=text[i];
  if(/\s/.test(c)){let j=i+1;while(j<text.length&&/\s/.test(text[j]))j++;add('space',j);continue;}
  if(language!=='json'&&text.startsWith('//',i)){const j=text.indexOf('\n',i+2);add('comment',j<0?text.length:j);continue;}
  if(language!=='json'&&text.startsWith('/*',i)){const j=text.indexOf('*/',i+2);add('comment',j<0?text.length:j+2);continue;}
  if(c==='"'||(language==='javascript'&&(c==="'"||c==='`'))){let j=i+1;while(j<text.length){if(text[j]==='\\'){j=Math.min(j+2,text.length);continue;}if(text[j++]===c)break;}add('string',j);continue;}
  numeric.lastIndex=i;const n=numeric.exec(text);if(n){add('number',numeric.lastIndex);continue;}
  const word=/[A-Za-z_][A-Za-z_\d]*/y;word.lastIndex=i;const w=word.exec(text);if(w){add('word',word.lastIndex);continue;}
  const op=['->','=>','==','!=','<=','>=','&&','||','..','::',':=','**'].find(x=>text.startsWith(x,i));
  if(op){add('operator',i+op.length);continue;}
  add('(){}[],:;.'.includes(c)?'punctuation':'+-*/!=?&|^~<>%'.includes(c)?'operator':'unknown',i+1);
 }
 return out;
}
export function highlightCode(text,language='ink') {
 const tokens=tokenize(text,language),significant=tokens.filter(x=>x.kind!=='space'&&x.kind!=='comment');
 const positions=new Map(significant.map((t,i)=>[t,i]));
 return tokens.map(t=>{let cls=t.kind;
  if(cls==='word'){
   const at=positions.get(t),next=significant[at+1]?.text,previous=significant[at-1]?.text;
   if(constants.has(t.text))cls='constant';
   else if((language==='javascript'?jsKeywords:inkKeywords).has(t.text))cls='keyword';
   else if(types.has(t.text)||/^[A-Z]/.test(t.text))cls='type';
   else if(previous==='fn'||next==='(')cls='function';
   else if(next===':')cls='property';
   else if(next==='<'){
    let depth=0;
    for(let j=at+1;j<Math.min(at+129,significant.length);j++){
     if(significant[j].text==='<')depth++;
     if(significant[j].text==='>'&&--depth===0){if(significant[j+1]?.text==='(')cls='function';break;}
     if([';','{','}'].includes(significant[j].text))break;
    }
   }else cls='';
  }else if(cls==='string'&&language==='json'&&significant[positions.get(t)+1]?.text===':')cls='property';
  return ['space','punctuation','unknown','word',''].includes(cls)?esc(t.text):`<span class="tok-${cls}">${esc(t.text)}</span>`;
 }).join('');
}
// Whitespace-only source formatting. A final lexical check prevents accidental
// operator merging, changes to literal/comment bytes or incomplete input edits.
export function formatInk(text,{width=88}={}){
 if(text.length>4*1024*1024)throw new RangeError('Source is too large to format');
 const ts=tokenize(text).filter(t=>t.kind!=='space');let level=0,line='',lines=[],stack=[],previous='';
 const genericOpen=at=>{if(!(types.has(ts[at-1]?.text)||/^[A-Z]/.test(ts[at-1]?.text??'')||ts[at-2]?.text==='fn'||ts[at-1]?.kind==='word'))return false;let depth=0;for(let j=at;j<Math.min(at+129,ts.length);j++){const s=ts[j].text;if(s==='<')depth++;if((s==='>'||s==='>=')&&--depth===0)return s==='>='||['(',')',',',';','{','}','=','>',']','->','reads','writes','emits','requires','ensures','where'].includes(ts[j+1]?.text);if([';','{','}','&&','||'].includes(s))break;}return false;};
 const flush=()=>{if(line.trim()){lines.push('    '.repeat(level)+line.trim());line='';}};
 const write=(s,space=false)=>{if(space&&line&&!line.endsWith(' '))line+=' ';line+=s;};
 for(let i=0;i<ts.length;i++){const t=ts[i],s=t.text,next=ts[i+1]?.text??'';
  if(t.kind==='unknown')throw new SyntaxError('Finish the source before formatting');
  if(t.kind==='string'&&(!s.endsWith('"')||s.length<2))throw new SyntaxError('Unclosed string');
  if(t.kind==='comment'){
   if(s.startsWith('/*')&&!s.endsWith('*/'))throw new SyntaxError('Unclosed comment');
   if(s.startsWith('//')){write(s,!!line);lines.push('    '.repeat(level)+line.trimStart());line='';}else{flush();lines.push('    '.repeat(level)+s);}previous='';continue;
  }
  if(s==='{'){write(s,!!line&&!['(', '[', '.'].includes(previous));stack.push(s);if(next!=='}'){flush();level++;}}
  else if(s==='}'){if(stack.pop()!=='{')throw new SyntaxError('Unbalanced braces');if(previous!=='{'){flush();level=Math.max(0,level-1);}write(s);if(![';',',',')',']','.','else'].includes(next)){flush();if(!stack.length&&['fn','query','change','record','enum','state','keep','trainable','learn','adaptive'].includes(next))lines.push('');}}
  else if(s==='('||s==='['){write(s,s==='['&&inkKeywords.has(previous)&&previous!=='fn');stack.push(s);}
  else if(s===')'||s===']'){if(stack.pop()!==(s===')'?'(':'['))throw new SyntaxError('Unbalanced delimiters');write(s);}
  else if(s===';'){write(s);flush();if(next&&['fn','query','change','record','enum','state','keep','trainable','learn','adaptive','import'].includes(next)&&stack.length===0)lines.push('');}
  else if(s===','){write(s);if(stack.at(-1)==='{')flush();else if(line.length+level*4>width){flush();}else write(' ');}
  else if(s===':'){write(': ');}
  else if(s==='.'||s==='..'){write(s);}
  else if(s==='<'&&genericOpen(i)){write(s);stack.push('<');}
  else if(s==='>'&&stack.at(-1)==='<'){stack.pop();write(s);}
  else if(s==='>='&&stack.at(-1)==='<'){stack.pop();write('>= ');}
  else if(t.kind==='operator'){write(s,!['!','~','?'].includes(s));if(!['!','~','?'].includes(s))write(' ');}
  else{write(s,!!line&&!['(', '[', '.', '..','<'].includes(previous)&&!line.endsWith(' '));}
  previous=s;
 }
 flush();if(stack.length)throw new SyntaxError('Finish the source before formatting');
 const result=lines.join('\n')+'\n';
 const again=tokenize(result).filter(t=>t.kind!=='space');
 if(again.length!==ts.length||again.some((t,i)=>t.kind!==ts[i].kind||t.text!==ts[i].text))throw new SyntaxError('Formatting would change source tokens');
 return result;
}
// Lossless JSON formatter: numbers and string spellings remain raw tokens. Never
// parse a whole document through Number, so integers/exponents/duplicate keys stay.
export function formatJSON(text,{width=88}={}){
 if(text.length>4*1024*1024)throw new RangeError('JSON is too large to format');
 const all=tokenize(text,'json');if(all.some(t=>t.kind==='space'&&/[^ \t\r\n]/.test(t.text)))throw new SyntaxError('Invalid JSON whitespace');
 const ts=all.filter(t=>t.kind!=='space');let i=0;
 const take=s=>{if(ts[i++]?.text!==s)throw new SyntaxError('Invalid JSON');};
 function parse(depth=0){if(depth>128)throw new RangeError('JSON nesting limit');const t=ts[i];if(!t)throw new SyntaxError('Incomplete JSON');
  if(t.text==='['){i++;const items=[];if(ts[i]?.text!==']'){for(;;){items.push(parse(depth+1));if(ts[i]?.text!==',')break;i++;}}take(']');return {kind:'array',items};}
  if(t.text==='{'){i++;const items=[];if(ts[i]?.text!=='}'){for(;;){const key=ts[i++];if(key?.kind!=='string')throw new SyntaxError('Expected JSON key');JSON.parse(key.text);take(':');items.push([key.text,parse(depth+1)]);if(ts[i]?.text!==',')break;i++;}}take('}');return {kind:'object',items};}
  if(t.kind==='string')JSON.parse(t.text);else if(t.kind!=='number'&&!['true','false','null'].includes(t.text))throw new SyntaxError('Invalid JSON token');i++;return {kind:'raw',text:t.text};
 }
 const tree=parse();if(i!==ts.length)throw new SyntaxError('Unexpected JSON token');
 function short(n,budget){if(n.kind==='raw')return n.text.length<=budget?n.text:null;if(n.kind==='object')return n.items.length?null:'{}';let s='[';for(const x of n.items){const item=short(x,budget-s.length-1);if(item===null)return null;s+=(s.length>1?', ':'')+item;if(s.length+1>budget)return null;}return s+']';}
 function render(n,depth){const pad='  '.repeat(depth),inner=pad+'  ';const compact=short(n,width-pad.length);if(compact!==null)return compact;
  if(n.kind==='raw')return n.text;
  if(n.kind==='object')return '{\n'+n.items.map(([k,v])=>inner+k+': '+render(v,depth+1)).join(',\n')+'\n'+pad+'}';
  if(n.items.every(x=>x.kind==='raw')){const lines=[];let line=inner;for(const item of n.items){const tail=line===inner?'':', ';if(line!==inner&&line.length+tail.length+item.text.length>width){lines.push(line+',');line=inner+item.text;}else line+=tail+item.text;}lines.push(line);return '[\n'+lines.join('\n')+'\n'+pad+']';}
  return '[\n'+n.items.map(v=>inner+render(v,depth+1)).join(',\n')+'\n'+pad+']';
 }
 return render(tree,0);
}
