// Use the distribution's exact core for every lowering dependency. Cargo cannot
// patch one revision with another revision from the same Git source.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../.ink-source',import.meta.url));
const pins=JSON.parse(readFileSync(new URL('../ink-pins.json',import.meta.url),'utf8'));
if(!/^[a-f0-9]{40}$/.test(pins.core)||pins.core!==pins.distribution)
  throw Error('The browser core must match the exact distribution revision.');
const git=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
if(!existsSync(`${source}/.git`)){
  mkdirSync(source,{recursive:true});
  execFileSync('git',['init',source],{stdio:'ignore'});
  git('remote','add','origin','https://github.com/siliconjungle/ink-lang.git');
  git('sparse-checkout','init','--cone');
  git('sparse-checkout','set','core');
}
if(git('remote','get-url','origin')!=='https://github.com/siliconjungle/ink-lang.git')
  throw Error('Unexpected compiler source remote.');
if(git('status','--porcelain','--untracked-files=all','--','core'))
  throw Error('Generated compiler source has local changes; refusing to replace it.');
let current;
try{current=git('rev-parse','--verify','HEAD');}catch{}
if(current!==pins.core){
  git('fetch','--depth=1','origin',pins.core);
  git('checkout','--detach','FETCH_HEAD');
}
export function verifyCore(){
  if(git('rev-parse','HEAD')!==pins.core||git('status','--porcelain','--untracked-files=all','--','core'))
    throw Error('Compiler source differs from the pinned distribution.');
}
verifyCore();
console.log(`Prepared the distribution core at ${pins.core}.`);
