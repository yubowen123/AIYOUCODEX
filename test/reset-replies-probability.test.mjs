import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResetRss, RESET_REPLIES_FEED} from '../lib/reset-rss.mjs';
import {classifyResetPost} from '../lib/reset-classifier.mjs';
import {estimateResetProbability} from '../lib/reset-announcements.mjs';
const now=Date.parse('2026-10-07T06:00:00Z');
const id='2107676072871600470';
const post={id,sourceUrl:`https://x.com/thsottiaux/status/${id}`,publishedAt:'2026-10-07T03:35:09Z',text:'We shipped four things, but the community demands a reset. Therefore ... the reset has been processed. Enjoy!'};
test('modern reply feed verifies query-bearing account URLs, includes Tibo replies and excludes community authors',()=>{
 const item=(author,id,text)=>`<item><title>${text}</title><link>https://x.com/${author}/status/${id}</link><pubDate>Wed, 07 Oct 2026 03:35:09 GMT</pubDate><description>${text}</description></item>`;
 const feed=`<rss><channel><link>https://fxtwitter.com/thsottiaux?with_replies=true&amp;count=100</link>${item('thsottiaux',id,'@The_Alex I do like giving resets')}${item('other','2107676072871600471','Codex will reset tomorrow')}</channel></rss>`;
 const entries=parseResetRss(feed,now);
 assert.equal(entries.length,1);assert.equal(entries[0].postKind,'reply');assert.equal(entries[0].relevant,true);
 assert.match(RESET_REPLIES_FEED,/with_replies=true/);
 assert.throws(()=>parseResetRss(feed.replace('fxtwitter.com/thsottiaux?','fxtwitter.com/not-tibo?'),now),/account/);
});
test('actual processed wording completes reset without inventing account delivery',()=>{
 const event=classifyResetPost(post,[],now);assert.equal(event.status,'completed');assert.notEqual(event.deliveryStatus,'delivered');
 const forecast=estimateResetProbability({events:[event],history:[],checkStatus:'ok',lastSuccessAt:new Date(now).toISOString()},now);
 assert.equal(forecast.value,null);assert.equal(forecast.latestCompleted.id,id);assert.match(forecast.reason,/已完成/);
});
test('new promises and reply intent contribute only after latest completion; failed scans retain a stale estimate',()=>{
 const completed=classifyResetPost(post,[],now);
 const reply={publishedAt:'2026-10-07T04:00:00Z',verification:'rss',postKind:'reply',evidence:'@The_Alex I do like giving resets'};
 const state={events:[completed],history:[reply],checkStatus:'ok',lastSuccessAt:new Date(now).toISOString()};
 assert.equal(estimateResetProbability(state,now).value,35);
 assert.equal(estimateResetProbability({...state,history:[{...reply,publishedAt:'2026-10-06T23:00:00Z'}]},now).value,null);
 const promise=classifyResetPost({...post,id:'2107676072871600472',sourceUrl:'https://x.com/thsottiaux/status/2107676072871600472',publishedAt:'2026-10-07T04:30:00Z',text:'We will reset Codex usage in two hours.'},[],now);
 assert.equal(estimateResetProbability({...state,events:[promise,completed]},now).value,90);
 assert.equal(estimateResetProbability({...state,events:[promise,completed],checkStatus:'error'},now).stale,true);
});
