/* Synthetic discovery presentation adapter only. Real RLS/atomic writes are tested in SQL. */
(function(){
const state=window.CRMPREVIEW,client=window.supabase.createClient();
state.db.instagram_media_catalog=[];state.db.instagram_discovery_state=[];state.db.notifications=state.db.notifications||[];
const original=client.rpc.bind(client);
client.rpc=async function(name,args={}){
 if(!['crm_request_instagram_scan','crm_instagram_review'].includes(name))return original(name,args);
 state.calls.push({rpc:name,args:structuredClone(args)});
 if(state.profile.role!=='owner')return {data:null,error:{code:'42501'}};
 if(state.failNext===name){state.failNext=null;return {data:null,error:{code:'TEST_FAILURE'}};}
 if(name==='crm_request_instagram_scan')return {data:{queued:true},error:null};
 const row=state.db.instagram_media_catalog.find(x=>x.id===args.p_id);if(!row)return {data:null,error:{code:'42501'}};
 if(row.updated_at!==args.p_expected)return {data:null,error:{code:'40001'}};
 row.state=args.p_decision==='link'?'linked':'non_property';row.property_id=args.p_property;row.updated_at=new Date().toISOString();return {data:{state:row.state},error:null};
};
})();
