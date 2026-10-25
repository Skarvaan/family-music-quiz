/* Setup im iPad-Betrieb: Handys treten bei, während am iPad eine
   Playlist-Auswahl im Fokus steht. Früher bekam der neue Spieler keine
   Zeile, bis man die Spieleranzahl änderte. Braucht Playwright. */
const root=require("path").join(__dirname,".."), http=require("http"), {spawn}=require("child_process");
const express=require("express"), {ExpressPeerServer}=require("peer");
let chromium; try{({chromium}=require("playwright"));}catch{console.log("Playwright fehlt, Test übersprungen.");process.exit(0);}
const results=[];const check=(l,ok,x="")=>{results.push(!!ok);console.log(`${ok?"ok  ":"FEHL"} ${l}${x?"  ·  "+x:""}`);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const pa=express(),ph=http.createServer(pa);pa.use("/",ExpressPeerServer(ph,{path:"/"}));await new Promise(r=>ph.listen(9127,"127.0.0.1",r));
 const app=spawn(process.execPath,[root+"/server.js"],{env:{...process.env,PORT:"3952"},stdio:"ignore"});
 await wait(1500);
 const b=await chromium.launch({args:["--disable-features=WebRtcHideLocalIpsWithMdns"]});
 try{
 const ctx=await b.newContext({viewport:{width:1180,height:820}});
 await ctx.route("https://api.spotify.com/**",async route=>{
   const u=new URL(route.request().url()); const j=(s,b)=>route.fulfill({status:s,contentType:"application/json",body:JSON.stringify(b)});
   if(u.pathname==="/v1/me")return j(200,{id:"bene"});
   if(u.pathname==="/v1/me/playlists")return j(200,{items:[{id:"plA",name:"Benes Liste",owner:{id:"bene"},items:{total:20}},{id:"plB",name:"Annas Liste",owner:{id:"bene"},items:{total:20}}],next:null});
   if(/\/v1\/playlists\/.*\/items/.test(u.pathname))return j(200,{total:8,items:Array.from({length:8},(_,k)=>({item:{type:"track",id:u.pathname+k,uri:"spotify:track:x"+k,name:"S"+k,duration_ms:200000,artists:[{name:"B"}],album:{release_date:"2001-01-01"}}}))});
   if(u.pathname==="/v1/me/player/devices")return j(200,{devices:[{id:"d",name:"iPad",is_active:true}]});
   return j(200,{});
 });
 const h=await ctx.newPage(); h.on("pageerror",e=>console.log("HOSTERR",e.message));
 await h.goto("http://127.0.0.1:3952/?net=peer&peerserver=127.0.0.1:9127");
 await h.evaluate(()=>{localStorage.setItem("spotify_access_token","x");localStorage.setItem("spotify_expires_at",String(Date.now()+3600e3));});
 await h.reload();
 await h.waitForFunction(()=>FMQ.app.playlists.length===2);
 await h.click("#multiDeviceModeBtn");
 await h.waitForFunction(()=>FMQ.multiplayer.connected);
 const url=await h.evaluate(()=>FMQ.getPhoneJoinUrl());
 // Wizard bis Schritt 4 durchklicken wie ein Mensch
 await h.click("#setupNextBtn"); await wait(300);
 await h.click('[data-category="self"]'); await wait(300);
 console.log("Schritt:",await h.evaluate(()=>FMQ.app.state.setupStep));
 const modeBtn=await h.$('[data-mode-id="quick3"]'); if(modeBtn){await modeBtn.click();await wait(300);}
 if(await h.evaluate(()=>FMQ.app.state.setupStep)<4){await h.click("#setupContinueBtn");await wait(300);}
 console.log("Schritt:",await h.evaluate(()=>FMQ.app.state.setupStep));
 // Host tippt einmal ins Formular (Fokus bleibt auf iPad oft stehen)
 const anySel=await h.$('#playersConfig select'); console.log("Selects vor Beitritt:",await h.$$eval('#playersConfig select[data-role="playlist"]',s=>s.length));
 // Handy tritt bei
 const p=await (await b.newContext({viewport:{width:390,height:780}})).newPage();
 await p.goto(url); await p.fill("#playerNameInput","Anna"); await p.click('#joinForm button[type="submit"]');
 await p.waitForFunction(()=>document.body.classList.contains("joined"));
 await wait(1500);
 const rows=await h.$$eval('#playersConfig select[data-role="playlist"]',s=>s.map(x=>({pid:x.dataset.pid,opts:x.options.length})));
 console.log("Selects nach Beitritt:",JSON.stringify(rows),"Spieler:",JSON.stringify(await h.evaluate(()=>FMQ.app.players.map(p=>({id:p.id,name:p.name})))));
 if(rows.length){ await h.selectOption(`#playersConfig select[data-pid="${rows[0].pid}"]`,"plA"); await wait(1500);
   console.log("Nach Auswahl:",JSON.stringify(await h.evaluate(()=>FMQ.app.players.map(p=>({name:p.name,pl:p.playlistId,tracks:(p.tracks||[]).length})))));}
 // Szenario 2: zweites Handy, während ein Select fokussiert ist
 await h.focus(`#playersConfig select[data-role="playlist"]`);
 const p2=await (await b.newContext({viewport:{width:390,height:780}})).newPage();
 await p2.goto(url); await p2.fill("#playerNameInput","Ben"); await p2.click('#joinForm button[type="submit"]');
 await p2.waitForFunction(()=>document.body.classList.contains("joined"));
 await wait(5000);
 const rows2=await h.$$eval('#playersConfig select[data-role="playlist"]',s=>s.map(x=>x.dataset.pid));
 check("Neuer Handy-Spieler bekommt Playlist-Zeile trotz Fokus", rows2.length===2);
 console.log("  Mit Fokus: Selects nach Ben:",rows2.length,"Spieler:",await h.evaluate(()=>FMQ.app.players.length),"Anna-Playlist erhalten:",await h.$eval('#playersConfig select[data-role="playlist"]',s=>s.value));
 const benPid=rows2[1]; if(benPid){await h.selectOption(`#playersConfig select[data-pid="${benPid}"]`,"plB");await wait(1500);const pl=await h.evaluate(()=>FMQ.app.players.map(p=>p.playlistId+":"+(p.tracks||[]).length).join(","));check("Playlist für beide wählbar, Tracks geladen",pl==="plA:8,plB:8",pl);}
 }catch(e){console.log("ABBRUCH",e.message);results.push(false)}
 await b.close(); app.kill(); ph.close(); const ok=results.length>0&&results.every(Boolean);console.log("\n"+(ok?"ALLE PRÜFUNGEN BESTANDEN":"ES GIBT FEHLSCHLÄGE"));process.exit(ok?0:1);
})();
