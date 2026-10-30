$(document).ready(function () {
  var vid = document.getElementById("video");
  var $play = $("#play");
  var $container = $("#container_video");
  var $close = $("#close");

  function stopVideo() {
    vid.pause();
    vid.muted = true;
    vid.style.filter = "brightness(0.5)";
  }

  function showPlayBtn() {
    $play.attr("style", "display:flex; max-width:300px; opacity:0.5; cursor:pointer; position:absolute; top:50%; left:50%; right:auto; bottom:auto; transform:translate(-50%,-50%); z-index:2; margin:0;");
  }

  stopVideo();

  vid.addEventListener("canplay", function () {
    if (vid.paused) {
      vid.style.filter = "brightness(0.5)";
    }
  });

  document.getElementById("play").addEventListener("click", function () {
    window.scrollTo(0, 0);
    $play.hide();
    vid.style.filter = "";
    vid.muted = false;
    vid.play();
    $container.addClass("fullscreen");
    $("body").addClass("noscroll");
    $close.show();
  });

  $(vid).on("ended", showOrder);
  $("#popup").on("click", showOrder);

  $close.on("click", function () {
    stopVideo();
    $container.removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $close.hide();
    showPlayBtn();
  });

  function showOrder() {
    stopVideo();
    $container.removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $close.hide();
    $container.fadeOut("fast", function () {
      $("#order").fadeIn("fast", function () {
        $("html, body").animate(
          { scrollTop: $("#order").offset().top - 20 },
          200
        );
        startTimer(600);
      });
    });
  }

  function startTimer(seconds) {
    var $timer = $(".timer_value");
    if (!$timer.length) return;
    var tick = function () {
      if (seconds <= 0) {
        $timer.text("00:00");
        return;
      }
      seconds--;
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      $timer.text(
        (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s
      );
      setTimeout(tick, 1000);
    };
    tick();
  }
});
