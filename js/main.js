/* Timer countdown */
(function(){
  var m=10,s=0;
  var em=document.querySelector('.min'),es=document.querySelector('.sec');
  if(!em||!es)return;
  setInterval(function(){
    if(m<=0&&s<=0)return;
    s--;if(s<0){s=59;m--;}
    em.textContent=m<10?'0'+m:m;
    es.textContent=s<10?'0'+s:s;
  },1000);
})();

/* Name validation - Czech chars only */
(function(){
  var n=document.querySelector('[name="name"]');
  if(!n)return;
  n.addEventListener('input',function(){
    var v=this.value.replace(/[^a-zA-ZáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]/g,'').replace(/^\s+/,'').replace(/\s\s+/g,' ');
    var p=v.split(' ');if(p.length>2)v=p[0]+' '+p[1];
    this.value=v;
  });
  n.addEventListener('blur',function(){this.value=this.value.trim();});
})();

/* Phone validation - digits only */
(function(){
  var p=document.querySelector('[name="phone"]');
  if(!p)return;
  p.addEventListener('input',function(){
    this.value=this.value.replace(/\D/g,'');
    this.setAttribute('pattern','[0-9]{6,}');
  });
})();

/* CTA smooth scroll */
document.querySelectorAll('.cta-float').forEach(function(b){
  b.addEventListener('click',function(e){
    e.preventDefault();
    var t=document.getElementById('objednat');
    if(t)t.scrollIntoView({behavior:'smooth'});
  });
});

/* Dynamic date */
(function(){
  var els=document.querySelectorAll('.js-date');
  if(!els.length)return;
  var d=new Date();
  var months=['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];
  var str=d.getDate()+'. '+months[d.getMonth()]+' '+d.getFullYear();
  els.forEach(function(el){el.textContent=str;});
})();
