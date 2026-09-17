import test from 'node:test';
import assert from 'node:assert/strict';
import {productNameRecords,rememberProductNames,readProductNames,captureProductNamesBestEffort} from '../lib/pmb-product-names.mjs';
const env={SUPABASE_URL:'https://example.test',SUPABASE_SECRET_KEY:'private'};
test('only exact PLU and real product names become minimal permanent evidence',()=>{
 const rows=productNameRecords([{plu:12,name:'House Margarita 2',secret:'omit',volumeOz:50},{plu:13,name:'PLU 13'},{plu:14,name:'Product PLU#14'},{plu:15,name:'Coming Soon!'},{name:'Strawberry Margarita 2'}],{source:'test',observedAt:'2026-09-15'});
 assert.equal(rows.length,1);assert.equal(rows[0].data.name,'House Margarita 2');assert.ok(!JSON.stringify(rows).includes('omit'));
});
test('same-name writes are idempotent and use insert-ignore rather than replacing history',async()=>{
 let call;await rememberProductNames([{plu:12,name:'House Margarita 2'}],{env,source:'test',fetchImpl:async(url,options)=>{call={url,options};return {ok:true,json:async()=>[]};}});
 assert.equal(call.options.headers.Prefer,'resolution=ignore-duplicates,return=representation');
 assert.equal(call.options.method,'POST');
});
test('reading product-name history paginates without dropping later names',async()=>{
 let count=0;const rows=await readProductNames({env,fetchImpl:async()=>({ok:true,json:async()=>++count===1?Array.from({length:500},(_,i)=>({data:{schemaVersion:1,plu:i+1,name:'Drink '+i}})):[{data:{schemaVersion:1,plu:501,name:'House Margarita 2'}}]})});assert.equal(rows.length,501);assert.equal(count,2);
});

test('forward capture ignores placeholders and never changes the supplied report',async()=>{
 const items=[{plu:12,name:'House Margarita 2',volumeOz:45,history:[{value:9}]},{plu:13,name:'PLU 13'}];
 const before=structuredClone(items);let sent;
 const result=await captureProductNamesBestEffort(items,{source:'forward-test',saveImpl:async rows=>{sent=rows;return {observed:rows.length,inserted:rows.length};}});
 assert.equal(result.saved,true);assert.deepEqual(sent,[{plu:12,name:'House Margarita 2'}]);assert.deepEqual(items,before);
});
test('storage failure cannot fail reporting and a later capture retries',async()=>{
 const items=[{plu:22,name:'Strawberry Margarita 2'}];let calls=0;
 const options={source:'failure-test',warn:()=>{},saveImpl:async()=>{calls++;if(calls===1)throw Error('storage offline');return {observed:1,inserted:1};}};
 assert.equal((await captureProductNamesBestEffort(items,options)).saved,false);
 assert.equal((await captureProductNamesBestEffort(items,options)).saved,true);
 assert.equal(calls,2);
 await captureProductNamesBestEffort(items,options);assert.equal(calls,2);
});
test('concurrent refreshes do not create overlapping background name writes',async()=>{
 let finish;let calls=0;const saveImpl=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const first=captureProductNamesBestEffort([{plu:33,name:'Espresso Martini 2'}],{source:'concurrent-test',saveImpl});
 const next=await captureProductNamesBestEffort([{plu:33,name:'Espresso Martini 2'}],{source:'concurrent-test',saveImpl});
 assert.equal(next.skipped,'in-progress');assert.equal(calls,1);finish({inserted:1});assert.equal((await first).saved,true);
});
test('distinct names and wall suffixes remain separate retained records',()=>{
 const rows=productNameRecords([{plu:12,name:'House Margarita 1'},{plu:12,name:'House Margarita 2'}],{source:'test'});
 assert.equal(rows.length,2);assert.notEqual(rows[0].source,rows[1].source);
});
