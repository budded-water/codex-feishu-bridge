import test from 'node:test';
import assert from 'node:assert/strict';
import { message, setup, until } from './helpers.js';
import { Feishu, normalizeMessage } from '../src/feishu.js';
import { Outbox } from '../src/outbox.js';
import { State } from '../src/state.js';
import { notificationPost, safeMentionText } from '../src/reply.js';
import { record } from '../src/types.js';

test('final answers reply to the immutable triggering message, without task footer, including clarification handoff', async t => {
 const h=setup();t.after(h.close);h.config.projectRouting='automatic';h.deliveries();
 const original=message('Fix it',{chatType:'group',createTime:'1000'});h.bridge.receive(original);await until(()=>h.turns().length===1);
 const first=h.current();h.codex.complete(first.threadId,first.turnId,'completed',JSON.stringify({kind:'question',project:null,text:'Which project?',continuePending:false}));await until(()=>!h.state.directories().length);h.deliveries();
 const reply=message('alpha',{chatType:'group',createTime:'2000'});h.bridge.receive(reply);await until(()=>h.turns().length===2);const router=h.current();
 h.codex.complete(router.threadId,router.turnId,'completed',JSON.stringify({kind:'project',project:'alpha',text:'',continuePending:true}));await until(()=>h.turns().length===3);
 const execution=h.current();h.codex.complete(execution.threadId,execution.turnId,'completed','Verified result');
 const delivery=h.state.pending()[0]!;assert.equal(delivery.replyTo,reply.id);assert.equal(delivery.body,'Verified result');assert.equal(delivery.final,1);
});

test('reply transport keeps UUID and only falls back after explicit deletion, never after uncertainty', async t => {
 const f=new Feishu({appId:'test',appSecret:'test'});t.after(()=>f.close());const calls:unknown[]=[];let code=0;
 Object.assign(f,{client:{im:{v1:{message:{reply:async (x:unknown)=>{calls.push(x);return {code,data:{message_id:'om_response'}};},create:async(x:unknown)=>{calls.push(x);return{code:0,data:{message_id:'om_fallback'}};}}}}}});
 assert.equal(await f.send('chat','Result','same-uuid',{replyTo:'om_original'}),'om_response');
 assert.deepEqual(record(calls[0]).path,{message_id:'om_original'});assert.equal(record(record(calls[0]).data).uuid,'same-uuid');assert.equal(calls.length,1);
 code=230011;assert.equal(await f.send('chat','Result','fallback-uuid',{replyTo:'om_deleted'}),'om_fallback');assert.equal(calls.length,3);
 Object.assign(f,{client:{im:{v1:{message:{reply:async()=>{throw new Error('uncertain');},create:async()=>{throw new Error('must never send elsewhere');}}}}}});
 await assert.rejects(f.send('chat','Result','stable',{replyTo:'om_original'}),/uncertain/);
});

test('natural supplement steers one owned running task without enqueueing or duplicating inference', async t => {
 const h=setup();t.after(h.close);h.deliveries();const input=message('Query users');h.bridge.receive(input);await until(()=>h.turns().length===1);
 h.bridge.receive(message('只看最近一周',{parentId:input.id}));await until(()=>h.codex.calls.some(x=>x.method==='turn/steer'));
 assert.equal(h.turns().length,1);assert.ok(!h.state.status(h.session.id).some(x=>x.status==='queued'));
 const steer=h.codex.calls.find(x=>x.method==='turn/steer')!;assert.match(JSON.stringify(steer.params.input),/最近一周/);
});

test('natural controls cannot target another owner or guess between simultaneous tasks', async t => {
 const h=setup();t.after(h.close);h.config.accessMode='tenant';h.config.allowedTenant='tenant';h.deliveries();
 const first=message('Work alpha');h.bridge.receive(first);await until(()=>h.turns().length===1);
 h.bridge.receive(message('先停一下',{user:'ou_other',parentId:first.id}));assert.ok(!h.codex.calls.some(x=>x.method==='turn/interrupt'));
 h.bridge.receive(message('/project beta'));const second=message('Work beta');h.bridge.receive(second);await until(()=>h.turns().length===2);h.deliveries();
 h.bridge.receive(message('先停一下'));assert.ok(!h.codex.calls.some(x=>x.method==='turn/interrupt'));assert.match(h.deliveries().join(''),/没能确定/);
 h.bridge.receive(message('停止当前任务',{parentId:first.id}));await until(()=>h.codex.calls.some(x=>x.method==='turn/interrupt'));
 assert.equal(h.codex.calls.filter(x=>x.method==='turn/interrupt').length,1);
});

test('plain pause cancels subsequent owned queued work, and stopped output is sent once', async t => {
 const h=setup();t.after(h.close);h.deliveries();h.bridge.receive(message('Work'));await until(()=>h.turns().length===1);
 h.bridge.receive(message('Another task'));h.deliveries();h.bridge.receive(message('先停一下'));await until(()=>!h.state.directories().length);
 assert.equal(h.turns().length,1);const replies=h.deliveries();assert.equal(replies.length,1);assert.match(replies[0]!,/取消后面的 1 个/);assert.ok(!replies[0]!.includes('已发送停止请求'));
});

test('notifications require explicitly selected members and never create a task or infer identities', t => {
 const h=setup();t.after(h.close);h.deliveries();
 const input=message('/通知 @Alex 请完成验收',{chatType:'group',mentions:[{id:'ou_alex',name:'Alex'}]});h.bridge.receive(input);h.bridge.receive(input);
 const pending=h.state.pending();assert.equal(pending.length,1);assert.equal(pending[0]!.replyTo,input.id);assert.deepEqual(JSON.parse(pending[0]!.mentions!),[{id:'ou_alex',name:'Alex'}]);
 const post=notificationPost(pending[0]!.body,JSON.parse(pending[0]!.mentions!));assert.ok(post.zh_cn.content[0]!.some(x=>x.tag==='at'&&x.user_id==='ou_alex'));h.deliveries();
 h.bridge.receive(message('请通知 Alex 验收',{chatType:'group'}));assert.match(h.deliveries().join(''),/成员选择器/);assert.equal(h.turns().length,0);assert.deepEqual(h.state.status(h.session.id),[]);
});

test('ordinary model markup cannot notify arbitrary members; code previews remain exact', () => {
 const text='<at user_id="ou_not_allowed">Alex</at>\n```html\n<at user_id="ou_example">Example</at>\n```';
 assert.equal(safeMentionText(text),'Alex\n```html\n<at user_id="ou_example">Example</at>\n```');
 const post=notificationPost('[[notify:ou_wrong]] [[notify:ou_alex]]',[{id:'ou_alex',name:'Alex'}]);
 assert.equal(post.zh_cn.content[0]!.filter(x=>x.tag==='at').length,1);assert.ok(JSON.stringify(post).includes('未通知'));
});

test('oversized and unsupported admitted inputs get one actionable reply and never execute', t => {
 const h=setup();t.after(h.close);h.deliveries();const oversized=message('x'.repeat(30001));h.bridge.receive(oversized);h.bridge.receive(oversized);
 assert.equal(h.state.pending().length,1);assert.match(h.deliveries().join(''),/太长/);
 h.bridge.receive(message('format',{unsupported:'image'}));assert.match(h.deliveries().join(''),/文字/);
 h.bridge.receive(message('x'.repeat(30001),{user:'ou_not_allowed'}));assert.deepEqual(h.deliveries(),[]);assert.equal(h.turns().length,0);
 const event={tenant_key:'tenant',sender:{sender_type:'user',sender_id:{open_id:'ou_owner'}},message:{chat_type:'p2p',message_type:'image',chat_id:'chat',message_id:'om_image',content:'{"image_key":"private"}'}};
 assert.equal(normalizeMessage(event)?.unsupported,'image');assert.equal(normalizeMessage({...event,message:{...event.message,chat_type:'group'}},'ou_bot'),undefined);
});

test('status presents current work; diagnostics only appear on demand and simplified answers bind the prompt', async t => {
 const h=setup();t.after(h.close);h.deliveries();h.bridge.receive(message('Investigate'));await until(()=>h.turns().length===1);const current=h.current();
 h.codex.ask('unsupported','unsupported/interaction',current);h.bridge.receive(message('/status'));const simple=h.deliveries().join('');assert.match(simple,/正在处理：Investigate/);assert.ok(!simple.includes('unsupported/interaction')&&!simple.includes('Codex 本机进程'));
 h.bridge.receive(message('/status 详情'));assert.match(h.deliveries().join(''),/unsupported\/interaction/);
 h.codex.ask('question','item/tool/requestUserInput',{...current,questions:[{id:'internal-id',question:'Which range?'}]});const prompt=h.deliveries().join('');assert.ok(!prompt.includes('internal-id'));const token=prompt.match(/问题 ([a-f0-9]{8})/)![1]!;
 h.bridge.receive(message(`/回答 ${token} 最近一周\n排除测试账号`));assert.deepEqual(h.codex.replies.at(-1),{id:'question',result:{answers:{'internal-id':{answers:['最近一周\n排除测试账号']}}}});
});

test('administrator approval messages never reply into the submitter chat and plain agreement cannot approve', async t => {
 const h=setup();t.after(h.close);h.config.approvalChat='oc_admin';h.deliveries();const input=message('Check identity');h.bridge.receive(input);await until(()=>h.turns().length===1);
 h.codex.ask('approve','item/commandExecution/requestApproval',{...h.current(),command:'aws sts get-caller-identity',reason:'Verify the configured account'});
 const approval=h.state.pending().find(x=>x.chat==='oc_admin')!;assert.ok(!approval.replyTo);assert.ok(!approval.mentions);assert.ok(approval.body.startsWith('需要你确认'));assert.match(approval.body,/aws sts get-caller-identity/);assert.match(approval.body,/本次动作/);
 h.bridge.receive(message('好',{chat:'oc_admin'}));assert.equal(h.codex.replies.length,0);
});

test('delivered task references and timing survive reopen; response association does not expose another owner', async t => {
 const h=setup();t.after(h.close);h.deliveries();const input=message('Work');const task=h.state.enqueue(h.session.id,input.text,{id:input.id});h.state.taskStatus(task.id,'running');h.state.phase(task.id,'routing');h.state.routeTask(task.id,h.session.id,'Work',{id:'old-reference'});h.state.phase(task.id,'execution');
 h.state.sendStatus(task.id,'chat','Working');const sent:unknown[]=[];const outbox=new Outbox(h.state,{async send(_chat,_text,_id,options){sent.push(options);return 'om_bot_status';}});await outbox.flush();
 assert.equal(record(sent[0]).replyTo,input.id);assert.equal(h.state.trigger(task.id),input.id);assert.equal(h.state.referencedTask('om_bot_status',h.session.owner),task.id);assert.equal(h.state.referencedTask('om_bot_status','other-owner'),undefined);
 const reopened=new State(h.config.stateDirectory);try {assert.equal(reopened.trigger(task.id),input.id);assert.equal(reopened.referencedTask('om_bot_status',h.session.owner),task.id);const row=reopened.metrics()[0]!;assert.ok(Number(row.created_at)<=Number(row.routing_at));assert.ok(Number(row.routing_at)<=Number(row.routed_at));assert.ok(Number(row.feedback_at)>=Number(row.created_at));}finally{reopened.close();}
});

test('sender metadata is scoped to the original chat, actor and tenant rather than inferred from names', async t => {
 const f=new Feishu({appId:'test',appSecret:'test'});t.after(()=>f.close());
 const session={id:'s',owner:'o',tenant:'tenant',user:'ou_owner',chat:'group',project:'alpha',directory:'dir',thread:null};
 let item={message_id:'om_source',chat_id:'group',sender:{id:'ou_owner',sender_type:'user',tenant_key:'tenant',sender_name:'Alex'},message_app_link:'https://applink.feishu.cn/client/message/open'};
 Object.assign(f,{client:{im:{v1:{message:{get:async()=>({code:0,data:{items:[item]}})}}}}});
 assert.deepEqual(await f.actor(session,'om_source'),{name:'Alex',link:item.message_app_link});
 item={...item,chat_id:'other'};assert.deepEqual(await f.actor(session,'om_source'),{});
 item={...item,chat_id:'group',sender:{...item.sender,id:'ou_other'}};assert.deepEqual(await f.actor(session,'om_source'),{});
});

test('slow approval identity lookups cannot publish an expired or completed request', async t => {
 let release!:(value:{name:string})=>void;
 const h=setup({async context(){return{status:'unavailable',messages:[],note:''};},actor(){return new Promise(done=>{release=done;});}});t.after(h.close);h.deliveries();
 h.bridge.receive(message('Work'));await until(()=>h.turns().length===1);h.config.approvalTimeoutSeconds=0.01;
 h.codex.ask('approval','item/commandExecution/requestApproval',{...h.current(),command:'echo readonly'});await until(()=>h.codex.replies.length===1);
 release({name:'Verified actor'});await new Promise<void>(resolve=>setImmediate(resolve));
 const text=h.deliveries().join('');assert.ok(!text.includes('需要你确认'));assert.match(text,/已过期/);assert.deepEqual(h.codex.replies[0],{id:'approval',result:{decision:'decline'}});
});

test('natural preparation supplements reach the first model input; unconfirmed starts never falsely accept them', async t => {
 const h=setup();t.after(h.close);h.deliveries();const request=h.codex.request.bind(h.codex);let release!:()=>void;
 h.codex.request=async <T>(method:string,params:unknown):Promise<T>=>{if(method==='thread/start')await new Promise<void>(done=>{release=done;});return request<T>(method,params);};
 const original=message('Inspect the database');h.bridge.receive(original);await until(()=>Boolean(release));
 h.bridge.receive(message('补充：不要修改数据',{parentId:original.id}));release();await until(()=>h.turns().length===1);
 assert.match(JSON.stringify(h.turns()[0]!.params.input),/不要修改数据/);assert.ok(!h.codex.calls.some(x=>x.method==='turn/steer'));
});

test('stopping an unconfirmed execution start drains the confirmed turn, rather than reporting a fictitious stop', async t => {
 const h=setup();t.after(h.close);h.deliveries();const request=h.codex.request.bind(h.codex);let release!:(v:{turn:{id:string;status:string}})=>void;let started=false;
 h.codex.request=async <T>(method:string,params:unknown):Promise<T>=>{if(method==='turn/start'&&!started){started=true;return await new Promise<{turn:{id:string;status:string}}>(done=>{release=done;}) as T;}return request<T>(method,params);};
 h.bridge.receive(message('Work'));await until(()=>Boolean(release));h.bridge.receive(message('先停一下'));assert.ok(!h.codex.calls.some(x=>x.method==='turn/interrupt'));
 release({turn:{id:'confirmed-turn',status:'inProgress'}});await until(()=>h.codex.calls.some(x=>x.method==='turn/interrupt'));
 assert.equal(h.codex.calls.find(x=>x.method==='turn/interrupt')!.params.turnId,'confirmed-turn');assert.ok(h.state.status(h.session.id).some(x=>x.status==='interrupted'));
});

test('native notification rendering never rewrites approval command examples inside fenced code', () => {
 const post=notificationPost('[[notify:ou_alex]]\n```txt\n[[notify:ou_alex]]\n```',[{id:'ou_alex',name:'Alex'}]);
 assert.equal(post.zh_cn.content[0]!.filter(x=>x.tag==='at').length,1);assert.ok(post.zh_cn.content[0]!.some(x=>x.tag==='md'&&x.text.includes('```txt\n[[notify:ou_alex]]')));
});

test('outbox drops expired approvals before sending, without creating fake feedback or losing the timeout notice', async t => {
 const h=setup();t.after(h.close);h.deliveries();const task=h.state.enqueue(h.session.id,'Work',{id:'om_original'});h.state.recordApproval('token',task.id,'approval',Date.now()-1);
 h.state.send('chat','Stale approval',{taskId:task.id,promptId:'token'});h.state.send('chat','This confirmation expired');
 const sent:string[]=[];const outbox=new Outbox(h.state,{async send(_chat,text){sent.push(text);}});await outbox.flush();
 assert.deepEqual(sent,['This confirmation expired']);assert.equal(h.state.metrics()[0]!.feedback_at,null);
});

test('recovery summarizes each owner separately and does not replay unfinished requests', t => {
 const h=setup();t.after(h.close);h.deliveries();h.state.enqueue(h.session.id,'One');h.state.enqueue(h.session.id,'Two');assert.equal(h.state.recover(),2);
 const notices=h.deliveries();assert.equal(notices.length,1);assert.match(notices[0]!,/2 个未完成/);assert.equal(h.state.recover(),0);assert.equal(h.turns().length,0);
});

test('a quoted supplementary image is passed as a real steer input, not an unread resource marker', async t => {
 const url='data:image/png;base64,aGVsbG8=';const requests:unknown[]=[];
 const h=setup({async context(_session,source,limit){requests.push({source,limit});return{status:'available',messages:[{sender:'Owner',type:'image',text:'Attached screenshot',quoted:true}],note:'',images:[{messageIndex:0,label:'Screenshot',url}]};}});t.after(h.close);h.deliveries();
 h.bridge.receive(message('Inspect alpha'));await until(()=>h.turns().length===1);
 h.bridge.receive(message('/补充 根据这张截图核对',{chatType:'group',createTime:'2000',parentId:'om_new_image'}));await until(()=>h.codex.calls.some(x=>x.method==='turn/steer'));
 assert.equal(record(requests[0]).limit,0);assert.equal(record(record(requests[0]).source).parentId,'om_new_image');
 const input=h.codex.calls.find(x=>x.method==='turn/steer')!.params.input as {type:string;url?:string}[];assert.ok(input.some(x=>x.type==='image'&&x.url===url));assert.equal(h.turns().length,1);
});

test('explicit registered project labels skip the classifier without letting an older decision override them', async t => {
 const h=setup();t.after(h.close);h.config.projectRouting='automatic';h.deliveries();
 h.bridge.receive(message('Work alpha'));await until(()=>h.turns().length===1);const old=h.current();
 h.bridge.receive(message('beta：查询注册人数'));await until(()=>h.turns().length===2);
 assert.equal(h.turns()[1]!.params.cwd,h.config.projects.beta);assert.equal(h.turns()[1]!.params.outputSchema,undefined);assert.equal(h.state.selected(message(''))!.project,'beta');
 h.codex.complete(old.threadId,old.turnId,'completed',JSON.stringify({kind:'project',project:'alpha',text:'',continuePending:false}));await until(()=>h.turns().length===3);
 assert.equal(h.state.selected(message(''))!.project,'beta');assert.equal(h.turns()[2]!.params.cwd,h.config.projects.alpha);
});
