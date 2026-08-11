(function() {
  var chestBtn = document.getElementById('pushChest');
  var chestImg = document.getElementById('chestImg');
  if (!chestBtn || !chestImg) return;

  var btnWrap = chestImg.querySelector('.chest__button');
  var animWrap = chestImg.querySelector('.chest__img--dinamic');
  var coinsWrap = chestImg.querySelector('.chest__coins');
  var orderWrap = chestImg.querySelector('.chest__order');
  var rotateEl = chestImg.querySelector('.chest__rotate');
  var titleWrap = chestImg.querySelector('.chest__title_wrap');

  chestBtn.addEventListener('click', function() {
    btnWrap.style.display = 'none';
    if (titleWrap) titleWrap.style.display = 'none';

    animWrap.style.display = 'block';

    setTimeout(function() {
      animWrap.style.display = 'none';
      coinsWrap.style.display = 'block';

      if (rotateEl) {
        rotateEl.classList.add('animate');
      }

      setTimeout(function() {
        orderWrap.style.display = 'block';
        orderWrap.style.opacity = '0';
        orderWrap.style.transition = 'opacity 0.5s ease';
        setTimeout(function() {
          orderWrap.style.opacity = '1';
        }, 50);
      }, 2200);
    }, 2500);
  });
})();
