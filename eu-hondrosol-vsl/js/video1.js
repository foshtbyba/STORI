$(document).ready(function () {
  var vid = document.getElementById("video");

  vid.pause();
  vid.style.filter = "brightness(0.5)";

  document.getElementById("play").addEventListener("click", function () {
    window.scrollTo(0, 0);
    $("#play").hide();
    vid.style.filter = "";
    $("#video").prop("muted", false);
    vid.play();
    $("#container_video").addClass("fullscreen");
    $("body").addClass("noscroll");
    $("#close").show();
  });

  $("#video").on("ended", showOrder);
  $("#popup").on("click", showOrder);

  $("#close").on("click", function () {
    vid.pause();
    vid.muted = true;
    vid.style.filter = "brightness(0.5)";
    $("#container_video").removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $("#close").hide();
    $("#play").css("display", "flex");
  });

  function showOrder() {
    vid.pause();
    vid.muted = true;
    $("#container_video").removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $("#close").hide();
    $("#container_video").fadeOut("fast", function () {
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
