(function(root){'use strict';
function parse(text,sets){let s=String(text).normalize('NFKC').toUpperCase().replace(/[·•‧∙|:]/g,' ').replace(/\s+/g,' ').trim();let matches=[...s.matchAll(/(?:^|[^A-Z0-9])([A-Z]{3})\s*[- ]?\s*([0-9]{3,4}[A-Z]?)\s*[/\\]\s*([0-9]{2,4})(?=$|[^0-9])/g)];let out=matches.filter(m=>sets.includes(m[1])&&Number(m[2].match(/^\d+/)[0])>0&&Number(m[3])>0).map(m=>({set:m[1],num:m[2].toLowerCase(),den:m[3]}));return out.length===1?out[0]:null;}
function key(c){return c.set+' '+c.num+' '+c.finish;}
function aggregate(items){let groups=new Map();for(const c of items){let k=key(c);if(c.finish==='review')k+=' '+c.id;let g=groups.get(k);if(g)g.ids.push(c.id);else groups.set(k,{...c,ids:[c.id]});}return [...groups.values()];}
function exportText(items){if(items.some(c=>c.finish==='review'))return null;return aggregate(items).map(c=>`${c.ids.length} ${c.set} ${c.num}${c.finish==='foil'?' foil':''}`).join('\n');}
function validate(set,num){return /^[A-Z]{3}$/.test(set)&&/^\d{3,4}[a-z]?$/.test(num)&&parseInt(num,10)>0;}
const api={parse,key,aggregate,exportText,validate};if(typeof module!=='undefined')module.exports=api;else root.RiftCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
