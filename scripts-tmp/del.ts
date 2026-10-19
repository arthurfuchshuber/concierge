const h = { "user-api-key": process.env.CHANNEX_API_KEY!, "Content-Type":"application/json" };
const B="https://app.channex.io/api/v1";
const ghosts=["1c2af184-e7e8-48dd-9061-dcac7d57bf88","5adbe8e7-b998-4478-a795-cf347f815974","5cc854ac-3385-450d-8123-c34800bf545c","944a9ddd-b8ab-458f-aa6b-412244744cf2","a3bcd271-aaff-4f0d-9c5a-c3985a27f502","b5636e74-5125-490e-a458-01d8b7b1b812","e993af07-5fd8-4a7a-81bb-817a46a927d1"];
const ch="5c446a0d-8ccf-4bae-bad9-819d8f782808";
const c=await (await fetch(`${B}/channels/${ch}`,{headers:h})).json();
const props=(c.data.attributes.properties??[]).filter((p:string)=>!ghosts.includes(p));
const pr=await fetch(`${B}/channels/${ch}`,{method:"PUT",headers:h,body:JSON.stringify({channel:{properties:props}})});
console.log("channel",pr.status,(await pr.text()).slice(0,150));
for(const g of ghosts){const r=await fetch(`${B}/properties/${g}?force=true`,{method:"DELETE",headers:h});console.log(g,r.status,(await r.text()).slice(0,120));}
