/* Apply the saved theme before first paint — prevents a light flash.
   Classic script in /public so it runs synchronously in <head> and stays
   allowed by the app's Content-Security-Policy (script-src 'self'). */
(function(){
  try{
    var t=localStorage.getItem('spicaTide_theme');
    if(t==='dark') document.documentElement.setAttribute('data-theme','dark');
  }catch(e){}
})();
