(()=>{'use strict';
const $=id=>document.getElementById(id),video=$('video'),selector=$('recipe-select');
const settings=window.RECIPE_PLAYER_SETTINGS||{};
const params=new URLSearchParams(window.location.search),embedded=params.get('embed')==='1',requestedRecipeId=params.get('recipe');
if(embedded){document.documentElement.classList.add('embedded');selector.disabled=true;selector.parentElement.hidden=true;}
const lead=Number.isFinite(settings.holdLeadSeconds)?Math.max(.04,Math.min(.15,settings.holdLeadSeconds)):.055;
function validStages(stages){return Array.isArray(stages)&&stages.length>0&&stages.every((s,i)=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&(!i?s.start<.1:Math.abs(s.start-stages[i-1].end)<.12));}
const recipes=(window.RECIPE_CATALOG?.recipes||[]).filter(r=>r.status==='ready'&&r.active!==false&&typeof r.video==='string'&&r.video&&validStages(r.stages||r.steps));
let failed=false;
function fail(message){failed=true;$('error').textContent=message;$('error').hidden=false;$('back').disabled=true;$('next').disabled=true;$('pause').hidden=true;}
if(!recipes.length){fail('No recipe videos are available. Keep the video assets with this player.');return;}
for(const recipe of recipes){const option=document.createElement('option');option.value=recipe.id;option.textContent=recipe.title;selector.append(option);}
let config=null,steps=[],current=0,mode='ready',visited=[],frameRequest=null,playToken=0,internalSeekTarget=null,lastObserved=0,readySource=false;
function stepDescription(stage){
 const description=[stage.description,stage.metadata?.description].find(value=>typeof value==='string'&&value.trim());
 if(description)return description.trim();
 const ingredient=(stage.title||'').replace(/^add\s+/i,'').trim().toLowerCase();
 if(['cranberry juice','lemonade','pink lemonade','strawberry lemonade'].includes(ingredient))return 'Fill the pitcher using the fountain drink machine in karaoke.';
 if(stage.id==='label'||stage.kind==='label')return 'Write the cocktail name and date on the sticker label, then write which cooler it goes in.';
 return '';
}
function normalize(recipe){return {id:recipe.id,title:recipe.title,video:recipe.video,poster:recipe.poster||'',duration:recipe.duration||null,steps:(recipe.stages||recipe.steps).map(s=>({id:s.id||'',title:s.title||'',amount:s.amount||'',description:stepDescription(s),start:s.start,end:s.end}))};}
function endTime(){const s=steps[current];return Math.max(s.start,s.end-lead);}
function canNext(){return !failed&&config!==null&&steps.length>0;}
function canBack(){return !failed&&config!==null&&steps.length>0;}
function sync(){
 $('back').disabled=!canBack();$('next').disabled=!canNext();$('pause').hidden=failed||mode!=='paused';
 $('back').title=current===0?'Restart this step':'Previous step';
 $('next').title=mode==='ready'?'Start recipe':current===steps.length-1?'Replay recipe':'Next step';
 video.setAttribute('aria-label',config.title+' — '+steps[current].title);
 const description=steps[current].description,caption=$('step-description');
 if(caption.textContent!==description)caption.textContent=description;
 caption.hidden=!description;
 const bars=$('timeline').children;
 for(let i=0;i<bars.length;i++){const s=steps[i];const fraction=i<current?1:i>current?0:(mode==='waiting'||mode==='finished')?1:Math.max(0,Math.min(1,(video.currentTime-s.start)/(s.end-s.start)));bars[i].firstElementChild.style.width=(fraction*100)+'%';}
}
function cancelWatch(){if(frameRequest===null)return;if(typeof video.cancelVideoFrameCallback==='function')video.cancelVideoFrameCallback(frameRequest);else if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frameRequest);frameRequest=null;}
function seekTo(time){internalSeekTarget=time;if(readySource)video.currentTime=time;}
function hold(){
 if(mode!=='playing')return;
 cancelWatch();mode=current===steps.length-1?'finished':'waiting';video.pause();
 const time=endTime();lastObserved=time;visited[current]=true;seekTo(time);sync();
}
function schedule(){
 if(frameRequest!==null||mode!=='playing')return;
 const token=playToken;
 const callback=()=>{if(token!==playToken||mode!=='playing')return;frameRequest=null;const time=video.currentTime;if(readySource&&!video.seeking&&time>=steps[current].start){lastObserved=Math.max(lastObserved,time);if(time>=endTime()){hold();return;}}sync();schedule();};
 frameRequest=typeof video.requestVideoFrameCallback==='function'?video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
}
async function playStep(){
 cancelWatch();const token=++playToken;mode='playing';lastObserved=steps[current].start;
 seekTo(steps[current].start);sync();
 try{await video.play();if(token===playToken&&mode==='playing')schedule();}
 catch{if(token===playToken){mode='paused';sync();}}
}
function selectRecipe(id){
 if(embedded&&id!==requestedRecipeId)return false;
 const recipe=recipes.find(r=>r.id===id);if(!recipe)return false;
 ++playToken;cancelWatch();video.pause();config=normalize(recipe);steps=config.steps;current=0;mode='ready';visited=steps.map(()=>false);lastObserved=steps[0].start;internalSeekTarget=null;readySource=false;
 selector.value=recipe.id;document.title=recipe.title+' · On Par';failed=false;$('error').hidden=true;
 video.poster=config.poster;video.src=config.video;video.load();
 $('timeline').replaceChildren(...steps.map(()=>{const segment=document.createElement('span'),fill=document.createElement('i');segment.append(fill);return segment;}));
 sync();return true;
}
function next(){if(!canNext())return;if(mode!=='ready')current=(current+1)%steps.length;playStep();}
function back(){if(!canBack())return;current=Math.max(0,current-1);playStep();}
async function togglePlayback(){
 if(failed)return;
 if(mode==='playing'){pausePlayback();}
 else if(mode==='paused'){const token=++playToken;mode='playing';sync();try{await video.play();if(token===playToken&&mode==='playing')schedule();}catch{if(token===playToken){mode='paused';sync();}}}
}
function pausePlayback(){
 if(mode!=='playing')return;
 ++playToken;cancelWatch();mode='paused';video.pause();sync();
}
$('next').addEventListener('click',next);$('back').addEventListener('click',back);
selector.addEventListener('change',()=>{if(!embedded)selectRecipe(selector.value);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePlayback();});
window.addEventListener('message',event=>{
 if(embedded&&event.source===window.parent&&event.origin===window.location.origin&&event.data?.type==='onpar:guided-player:pause')pausePlayback();
});
video.addEventListener('click',togglePlayback);$('pause').addEventListener('click',togglePlayback);
video.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();togglePlayback();}});
$('sound').addEventListener('click',()=>{video.muted=!video.muted;$('sound').setAttribute('aria-pressed',String(video.muted));$('sound').setAttribute('aria-label',video.muted?'Unmute audio':'Mute audio');$('sound').title=video.muted?'Unmute audio':'Mute audio';$('sound').textContent=video.muted?'♩':'♫';});
$('fullscreen').addEventListener('click',()=>{const result=document.fullscreenElement?document.exitFullscreen?.():$('stage').requestFullscreen?.();result?.catch?.(()=>{});});
video.addEventListener('loadedmetadata',()=>{if(!config)return;readySource=true;seekTo(internalSeekTarget??steps[current].start);sync();});
video.addEventListener('seeked',()=>{if(internalSeekTarget!==null&&Math.abs(video.currentTime-internalSeekTarget)<.15)internalSeekTarget=null;});
video.addEventListener('timeupdate',()=>{if(!config||!readySource)return;const time=video.currentTime;if(!video.seeking&&time>=steps[current].start&&time<=steps[current].end+.15)lastObserved=Math.max(lastObserved,time);if(mode==='playing'&&!video.seeking&&time>=endTime())hold();sync();});
video.addEventListener('ended',()=>{if(readySource&&mode==='playing'&&!video.seeking&&video.currentTime>=endTime())hold();});
video.addEventListener('error',()=>{pausePlayback();fail('This recipe video could not load. Reload the guide to try again.');});
window.recipePlayer=Object.freeze({
 getState:()=>({recipeId:config?.id,current,mode,currentTime:video.currentTime,canNext:canNext(),canBack:canBack(),visited:[...visited]}),
 getConfig:()=>JSON.parse(JSON.stringify(config)),
 getCatalog:()=>recipes.map(r=>({id:r.id,title:r.title})),
 selectRecipe
});
if(params.has('recipe')||embedded){
 if(!requestedRecipeId||!selectRecipe(requestedRecipeId))fail('A guided video is not available for this recipe. Use the written recipe above.');
}else{
 selectRecipe(recipes.some(r=>r.id===settings.defaultRecipeId)?settings.defaultRecipeId:recipes[0].id);
}
})();
