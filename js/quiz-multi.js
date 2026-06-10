$(document).ready(function () {
  // Quiz Pcs Counter
  var number = 48;
  var value = localStorage.getItem("counter") || number;
  if (value <= 0) value = number;
  document.getElementById("pcs-left").innerHTML = value;

  var counter = function () {
    value = parseInt(value) - 1;
    if (value <= 0) value = number;
    localStorage.setItem("counter", value);
    document.getElementById("pcs-left").innerHTML = value;
  };
  var interval = setInterval(counter, 30000);

  // Таймер
  let n = 600;
  let o;
  function c() {
    --n;
    let e = Math.floor(n / 60),
      t = n % 60;
    if (e === 0 && t === 0) clearInterval(o);
    t = t < 10 ? "0" + t : t;
    e = e < 10 ? "0" + e : e;
    $("#mins").text(e);
    $("#secs").text(t);
  }

  const steps = document.querySelectorAll(".quiz-step");
  const navDots = document.querySelectorAll(".num");
  let currentStep = 0;
  let timerStarted = false;

  function goToStep(stepIndex) {
    steps.forEach((step, index) => {
      step.classList.toggle("active", index === stepIndex);
      step.style.display = index === stepIndex ? "block" : "none";
      if (navDots[index]) navDots[index].classList.toggle("active", index === stepIndex);
    });

    currentStep = stepIndex;

    if (stepIndex === 3 && !timerStarted) {
      timerStarted = true;
      $(".quiz-nums").hide();
      $(".quiz-title").hide();
      $(".order-title").show();
      o = setInterval(c, 1000);
      setTimeout(() => {
        const scrollTo = $("#oneform").offset().top;
        $("body,html").animate({ scrollTop: scrollTo }, 800);
      }, 400);
    }
  }

  // INIT
  goToStep(0);

  // MULTI SELECT on Step 2
  $(".quiz-step").eq(1).addClass("quiz-step-2");
  $(".quiz-step-2 .option").on("change", function () {
    $(this).toggleClass("active");
  });
  // Add continue button to step 2
  const continueBtn = $('<button class="button continue-button">Continua</button>');
  $(".quiz-step-2").append(continueBtn);

  continueBtn.on("click", function () {
    const selected = $(".quiz-step-2 .option.active");
    if (selected.length === 0) {
      $(".quiz-popup").addClass("active");
      setTimeout(() => {
        $(".quiz-popup").removeClass("active");
      }, 2500);
      return;
    }
    goToStep(2);
  });

  // SINGLE SELECT on steps 1 and 3
  $(".quiz-step")
    .not(".quiz-step-2")
    .find(".option")
    .on("click", function () {
      if (currentStep >= 3) return;
      const $option = $(this);
      $option.addClass("active");
      setTimeout(() => goToStep(currentStep + 1), 400);
    });
});
