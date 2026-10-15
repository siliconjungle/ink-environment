export type Token = {kind:string;text:string;start:number;end:number};
export const inkKeywords:Set<string>;
export function tokenize(text:string,language?:string):Token[];
export function highlightCode(text:string,language?:string):string;
export function formatInk(text:string,options?:{width?:number}):string;
export function formatJSON(text:string,options?:{width?:number}):string;
