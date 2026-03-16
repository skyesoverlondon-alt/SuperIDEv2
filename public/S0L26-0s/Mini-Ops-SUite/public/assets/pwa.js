(function(){
  "use strict";
  if(!("serviceWorker" in navigator)) return;

  async function register(){
    try{
      const reg = await navigator.serviceWorker.register("/sw.js", {scope:"/"});
      // If there is a waiting worker already, notify
      if(reg.waiting && navigator.serviceWorker.controller){
        notifyUpdate(reg);
      }
      reg.addEventListener("updatefound", ()=>{
        const nw = reg.installing;
        if(!nw) return;
        nw.addEventListener("statechange", ()=>{
          if(nw.state === "installed" && navigator.serviceWorker.controller){
            notifyUpdate(reg);
          }
        });
      });
    }catch(e){
      // Silent: offline app still works without SW
    }
  }

  async function notifyUpdate(reg){
    try{
      const SkyeShell = window.SkyeShell;
      if(!SkyeShell || !SkyeShell.modal) return;
      const r = await SkyeShell.modal({
        title:"Update available",
        text:"A new version is ready. Reload to apply the update.",
        okText:"Reload",
        cancelText:"Later",
        type:"text",
        placeholder:"",
        require:false
      });
      if(r && r.ok){
        try{ reg.waiting?.postMessage({type:"SKIP_WAITING"}); }catch(_){}
        setTimeout(()=>location.reload(), 250);
      }
    }catch(_){}
  }

  navigator.serviceWorker.addEventListener("controllerchange", ()=>{
    // After skipWaiting
  });

  register();
})();
