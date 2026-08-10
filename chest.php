<!DOCTYPE html>
<html lang="ar" dir="rtl">

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta content="initial-scale=1,maximum-scale=1,user-scalable=no" name="viewport" />
    <title>عرض خاص — JoActive</title>
    <link href="css/styles.css" media="all" rel="stylesheet" />
    <link href="css/css.css" media="all" rel="stylesheet" />
    <link rel="icon" href="images/JoActive.png" />

    <!-- Meta Pixel -->
    <script>
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');
      (function(){
        var params = new URLSearchParams(location.search);
        var p = params.get('fbpxl');
        if (!p) try { p = localStorage.getItem('fb_pixel'); } catch(e) {}
        if (p) { try { localStorage.setItem('fb_pixel', p); } catch(e) {} fbq('init', p); fbq('track', 'PageView'); }
      })();
    </script>
    <!-- End Meta Pixel -->
</head>

<body>
  <span id="oneform"></span>
    <div class="container">
        <div class="chest">
            <div class="top_block">
                <h1>شاركوا في عملية «<span class="productName">JoActive</span>» !</h1>
                <p class="vis_big">
                    <span style="font-weight: 500">
                  يمكن لكل مشارك في هذه العملية الحصول على منتج طبيعي وفعّال بسعر <b class="new_price_val">499</b>&nbsp;<b class="new_price_cur">ر.س</b> فقط.</span>
                </p>
            </div>
        </div>
        <div class="select_block">
            <h2 class="select_block__title"><span style="color: red">انتبه!</span> بسبب الطلب الكبير، لا يمكننا خدمة جميع العملاء.</h2>
            <p class="text_big">
                لذلك نظّمنا هذه القرعة التي تختار الفائزين واحداً تلو الآخر وتمنحكم فرصة الحصول على
                <span class="productName">JoActive</span> بسعر خاص.
            </p>
        </div>
        <div class="chest__img_pack" id="chestImg">
            <div class="chest__title_wrap">
                <h3 class="chest__title">جرّبوا حظكم!</h3>
                <h3 class="chest__subtitle">اضغطوا على الصندوق واربحوا <span class="danger-text">جائزتكم</span> !
                </h3>
            </div>
            <div class="chest__button">
                <picture>
                    <source class="chest__img" srcset="images/chest.webp" type="image/webp" />
                    <img src="images/chest.webp" alt="" class="saleBox" />
                </picture>
                <button id="pushChest">افتح</button>
            </div>
            <div class="chest__img--dinamic chest__img">
                <picture>
                    <source srcset="images/chest_animation.webp" type="image/webp" />
                    <img src="images/chest_animation.gif" alt="" style="max-width: 350px; width: 100%" />
                </picture>
            </div>
            <div class="chest__coins">
                <picture class="chest__img chest__img--opened">
                    <source srcset="images/chest_opened.webp" type="image/webp" />
                    <img src="images/chest_opened.png" alt="" style="max-width: 350px; width: 100%" />
                </picture>
                <div class="chest__rotate">
                    <picture class="back">
                        <source srcset="images/coin2.webp" type="image/webp" />
                        <img src="images/coin2.png" alt="" style="max-width: 350px; width: 100%" />
                    </picture>
                    <picture class="front">
                        <source srcset="images/coin2.webp" type="image/webp" />
                        <img src="images/coin2.png" alt="" style="max-width: 350px; width: 100%" />
                    </picture>
                </div>
            </div>
            <div class="chest__order">
                <div class="my_form">
                    <img src="images/JoActive.png" alt="JoActive" class="prodImg" style="max-width: 200px" />
                    <div class="text_popup">
                        <span style="display: block">تهانينا!</span> لقد حصلت على خصم 50% على <span class="productName">JoActive</span>! يمكنك الحصول عليه بسعر <b class="new_price_val" style="color:red">499</b>&nbsp;<b class="new_price_cur"
                            style="color:red">ر.س</b> فقط!
                    </div>
                    <br /><br />
                    <form id="order_form" method="POST" action="lemon.php">
                        <input type="hidden" name="utm_source" />
                        <input type="hidden" name="utm_medium" />
                        <input type="hidden" name="utm_campaign" />
                        <input type="hidden" name="utm_content" />
                        <input type="hidden" name="utm_term" />
                        <input type="hidden" name="clickid" />
                        <input type="hidden" name="fbpxl" />
                        <input type="text" minlength="2" class="input-roulette" name="name" id="input-name" placeholder="أدخل اسمك" autocomplete="name" required />
                        <input maxlength="18" minlength="8" type="tel" class="input-roulette" name="phone" id="input-phone" placeholder="أدخل رقم هاتفك" autocomplete="tel" required />
                        <input type="submit" class="submit-roulette" value="تقديم الطلب" />
                        <div class="ring-loading"></div>
                    </form>
                </div>
            </div>
        </div>
    </div>
    <script src="js/bounce.js"></script>
<script>
document.querySelectorAll('img').forEach(function(img){ img.loading = 'lazy'; });

document.querySelectorAll('a').forEach(function(a){
  a.addEventListener('click', function(e){
    e.preventDefault();
    document.getElementById('oneform').scrollIntoView({behavior:'smooth'});
  });
});

var nameInput = document.querySelector('[name="name"]');
if(nameInput){
  nameInput.addEventListener('input', function(){
    var v = this.value.replace(/[^\p{L}\s]/gu,'').replace(/^\s+/,'').replace(/\s\s+/,' ');
    var parts = v.split(' ');
    if(parts.length > 2) v = parts[0]+' '+parts[1];
    this.value = v;
  });
  nameInput.addEventListener('blur', function(){ this.value = this.value.trim(); });
}

var phoneInput = document.querySelector('[name="phone"]');
if(phoneInput){
  phoneInput.addEventListener('input', function(){
    this.value = this.value.replace(/\D/g,'');
    this.setAttribute('pattern','[0-9]{6,}');
  });
}

(function(){
  var params = new URLSearchParams(location.search);
  var fields = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','clickid','fbpxl'];
  fields.forEach(function(f){
    var v = params.get(f);
    if(v){
      var el = document.querySelector('input[name="'+f+'"]');
      if(el) el.value = v;
    }
  });
  var px = params.get('fbpxl');
  if(!px) try { px = localStorage.getItem('fb_pixel'); } catch(e){}
  if(px){
    var pxEl = document.querySelector('input[name="fbpxl"]');
    if(pxEl) pxEl.value = px;
  }
})();
</script>
</body>

</html>
