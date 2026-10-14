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

/* Name validation - Spanish chars only */
(function(){
  var n=document.querySelector('[name="name"]');
  if(!n)return;
  n.addEventListener('input',function(){
    var v=this.value.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ ]/g,'').replace(/^\s+/,'').replace(/\s\s+/g,' ');
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
  var months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var str=d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
  els.forEach(function(el){el.textContent=str;});
})();

/* Before/After carousel */
(function(){
  var c=document.querySelector('.ba-carousel');
  if(!c)return;
  var track=c.querySelector('.ba-track');
  var slides=c.querySelectorAll('.ba-slide');
  var dots=c.querySelector('.ba-dots');
  var prev=c.querySelector('.ba-prev');
  var next=c.querySelector('.ba-next');
  var idx=0,total=slides.length,timer;
  for(var i=0;i<total;i++){var d=document.createElement('span');if(i===0)d.className='active';dots.appendChild(d);}
  var dotEls=dots.querySelectorAll('span');
  function go(n){idx=(n+total)%total;track.style.transform='translateX(-'+idx*100+'%)';dotEls.forEach(function(d,i){d.className=i===idx?'active':'';});}
  prev.addEventListener('click',function(){go(idx-1);reset();});
  next.addEventListener('click',function(){go(idx+1);reset();});
  dots.addEventListener('click',function(e){if(e.target.tagName==='SPAN'){go([].indexOf.call(dotEls,e.target));reset();}});
  var sx=0;track.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;},{passive:true});
  track.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>40){go(dx>0?idx-1:idx+1);reset();}},{passive:true});
  function reset(){clearInterval(timer);timer=setInterval(function(){go(idx+1);},4000);}
  timer=setInterval(function(){go(idx+1);},4000);
})();
