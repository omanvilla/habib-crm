// Deep link: https://omanvilla.github.io/habib-crm/?wa=<conversation id> opens that WhatsApp conversation.
// The id survives the sign-in screen via sessionStorage, and the CRM's own opener (with its normal
// permission checks) does the work; this file only waits for the app and the signed-in profile.
(function(){
  var KEY='crm_open_wa', ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var id=null;
  try{var q=new URLSearchParams(location.search);id=q.get('wa');
    if(id&&ID.test(id)){sessionStorage.setItem(KEY,id);q.delete('wa');history.replaceState(null,'',location.pathname+(q.toString()?'?'+q.toString():'')+location.hash);}
    else id=sessionStorage.getItem(KEY);}catch(e){}
  if(!id||!ID.test(id))return;
  var tries=0, timer=setInterval(function(){
    tries++;
    var ready=(typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.company_id);
    if(ready&&typeof openDashboardWhatsAppConversation==='function'){done();openDashboardWhatsAppConversation(id);}
    else if(ready&&typeof openWhatsAppConversation==='function'&&typeof navigate==='function'){done();navigate('whatsapp',null);setTimeout(function(){openWhatsAppConversation(id);},300);}
    else if(tries>1200)done(); // give up after 10 minutes (sign-in can take a while)
  },500);
  function done(){clearInterval(timer);try{sessionStorage.removeItem(KEY);}catch(e){}}
})();
