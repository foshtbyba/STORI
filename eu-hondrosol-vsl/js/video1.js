$(document).ready(function () {
  document.getElementById("play").addEventListener("click", () => {
    window.scrollTo(0, 0);
    $("#play").fadeOut("fast", function () {
      $("#video").prop("muted", false).trigger("play");
      $("#container_video").addClass("fullscreen");
      $("body").addClass("noscroll");
      $("#close").fadeIn();
    });
  });

  $("#video").on("ended", showOrder);
  $("#popup").on("click", showOrder);

  $("#close").on("click", function () {
    $("#video")[0].pause();
    $("#video").prop("muted", true);
    $("#container_video").removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $("#close").fadeOut();
    $("#play").fadeIn();
  });

  function showOrder() {
    $("#container_video").removeClass("fullscreen");
    $("body").removeClass("noscroll");
    $("#close").fadeOut();
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
