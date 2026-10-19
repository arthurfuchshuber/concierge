const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const key = process.env.CHANNEX_API_KEY!;
const h = { "user-api-key": key, "Content-Type":"application/json" };
const all:any[]=[];for(let p=1;p<20;p++){const r=await (await fetch(`https://app.channex.io/api/v1/properties?pagination[page]=${p}&pagination[limit]=100`,{headers:h})).json();all.push(...r.data);if(r.data.length<100)break;}
const m=all.filter(x=>/Studio n° ?[34]/i.test(x.attributes.title)||/Marcos/i.test(x.attributes.title));
const {data:used}=await (supabaseAdmin as any).from("property_listing_raw_data").select("channex_property_id");
const u=new Set((used??[]).map((x:any)=>x.channex_property_id));
const {data:tw}=await (supabaseAdmin as any).from("channex_twin_links").select("*");
for(const t of tw??[])for(const k of Object.keys(t))if(typeof t[k]==="string")u.add(t[k]);
for(const x of m)console.log(x.id,u.has(x.id)?"OFFICIAL":"ghost",x.attributes.title);
