const config=require('./cloud-config.cjs');
function createRealtimeClient({cloud}) {
 const {createClient}=require('./vendor/supabase.cjs');
 return createClient(config.url,config.key,{accessToken:()=>cloud.token(),auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
module.exports={createRealtimeClient};
