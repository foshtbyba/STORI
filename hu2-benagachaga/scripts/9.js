const percent = document.currentScript.getAttribute('dtp') ?? 0;
$(document).ready(function() {

	let isOrderPopup = false;
	let isOrderPopupReady = false;
	if (document.getElementById('order_popup')) {
		isOrderPopup = true;
	}
	let isFP = true;

	if (document.querySelector('#screen-1') && document.querySelector('#screen-2')) {
		document.body.style.overflowX = 'hidden';

		document.querySelectorAll('#screen-2 *').forEach(e => {
			e.classList.add('is-visible');
		})
		if (!document.querySelector('#order') && document.querySelector('#screen-2 .body-wrap')) {
			document.querySelector('#screen-2 .body-wrap').id = 'order';
		}
		document.querySelector('#offer-timer-count').classList.add('timer');
		document.querySelectorAll('.form-timer').forEach(t => {
			t.classList.add('timer');
		})

		const heroVideo = document.querySelector('.hero-video');
		const videoModal = document.querySelector('.video-modal');

		if (heroVideo) {
			heroVideo.id = 'container_video';
			const videoEl = heroVideo.querySelector('video');
			if (videoEl) videoEl.id = 'video';
			if (!heroVideo.querySelector('#play')) {
				const playBtn = document.createElement('div');
				playBtn.id = 'play';
				heroVideo.prepend(playBtn);
			}
			if (!heroVideo.querySelector('#close')) {
				const closeBtn = document.createElement('div');
				closeBtn.id = 'close';
				closeBtn.style.display = 'none';
				heroVideo.appendChild(closeBtn);
			}
		}
		if (videoModal) videoModal.remove();
	}

	if (document.querySelector('#container_video')) {
		// type 1

		document.getElementById('play').addEventListener('click', () => {
			window.scrollTo(0, 0)
			$('#play').fadeOut('fast', function() {
				if (isFP) {
					isFP = false;
					$('#video').prop('muted', false).prop('currentTime', 0).trigger('play')
				} else {
					$('#video').prop('muted', false).trigger('play')
				}
				
				// $('#video').prop('muted', false).prop('currentTime', 999999999).trigger('play');
				$('#container_video').addClass('fullscreen');
				$('body').addClass('noscroll');
				$('#close').fadeIn();
				showPlay = false;
			})
		})
		const isOV = document.getElementById('open-video') ? true : false;
		if (isOV) {
			document.getElementById('open-video').addEventListener('click', () => {
				window.scrollTo(0, 0)
				$('#open-video').fadeOut('fast', function() {
					if (isFP) {
						isFP = false;
						$('#video').prop('muted', false).prop('currentTime', 0).trigger('play')
					} else {
						$('#video').prop('muted', false).trigger('play')
					}
					$('#container_video').addClass('fullscreen');
					$('body').addClass('noscroll');
					$('#close').fadeIn();
					showPlay = false;
				})
			})
		}

		if (isOrderPopup) {
			if (percent > 0 && percent <= 100) {
				$('#video').on('timeupdate', (e) => {
					if (percent != 100 && e.target.currentTime / e.target.duration >= (percent / 100)){
						isOrderPopupReady = true;
						
					} else {
						isOrderPopupReady = false;
					}
				});
			} else {
				isOrderPopupReady = true;
			}
		}
	
		$('#video').on('ended', showOrder);
	
		$('#close').on('click', function() {
			$(this).hide();
			// $('#video').prop('muted', true);
			$('#video').prop('muted', false);
			$('#container_video').removeClass('fullscreen');
			$('body').removeClass('noscroll');
			if (isOV) 
				$('#open-video').fadeIn('fast');
			else
				$('#play').fadeIn('fast');
			$('#popup').fadeOut('fast');
			if (isOrderPopup && isOrderPopupReady) {
				showOrderPopup();
			}
		});
	
		function showOrder() {
			$('#container_video').removeClass('fullscreen');
			$('body').removeClass('noscroll');
			$('#popup').fadeOut();
			$('#close').fadeOut();
			if (isOV) 
				$('#open-video').fadeOut();
			else
				$('#play').fadeOut();
			$('#video').fadeOut('fast', function() {
				$(this).trigger('pause');
				$('#order').fadeIn('fast', function() {
					$('html, body').animate({ scrollTop: $('#order').offset().top-20 }, 200);
				})
			})
			startTimers()
		}
	} else if (document.querySelector('.section-video')) {
		// type 2

		const orderBlock = $('#order.section-form');
		if (!orderBlock.hasClass('none'))
			orderBlock.addClass('none')

		const closeop = $('#order_popup .close_order_popup');
		if (closeop.text().trim() == '') {
			closeop.html('×');
			closeop.css('background-image', 'unset')
		}

		if (isOrderPopup) {
			if (percent > 0 && percent <= 100) {
				$('#video').on('timeupdate', (e) => {
					if (percent != 100 && e.target.currentTime / e.target.duration >= (percent / 100)) {
						isOrderPopupReady = true;

					} else {
						isOrderPopupReady = false;
					}
				});
			} else {
				isOrderPopupReady = true;
			}
		}

		function fullScreenOn() {
			$('.div-video').addClass('full-video');
			$('.div-video').removeClass('relative');
			$('.notification').addClass('none');
			$('.close').removeClass('none');
	
			if (isFP) {
				isFP = false;
				$('#video').prop('muted', false).prop('currentTime', 0).trigger('play');				
			} else {
				$('#video').prop('muted', false).trigger('play');
			}
			// $('#video').prop('muted', false).prop('currentTime', 9999999999).trigger('play');
	
			$('#video').css('max-width', '90%');
			$('#video').css('max-height', '90%');
		}
		function fullScreenOff() {
			$('.div-video').removeClass('full-video');
			$('.div-video').addClass('relative');
			$('.notification').removeClass('none');
			$('.close').addClass('none');
	
			// $('#video').prop('muted', true);
	
			$('#video').css('max-width', '900px');
			$('#video').css('max-height', 'none');
		}
	
		let isFullScreen = false;
		document.querySelector('.div-video').addEventListener('click', (e) => {
			if (!isFullScreen) {
				isFullScreen = true;
	
				window.scrollTo(0, 0);
				fullScreenOn();
	
			} else {
				isFullScreen = false;
				
				fullScreenOff();
				if (isOrderPopup && isOrderPopupReady) {
					showOrderPopup();
				}
			}
			
		})
	
		$('#video').on('ended', openForm);
	
		$('#close').on('click', function() {
			fullScreenOff();
		});
	
		function openForm() {
			if (isFullScreen) {
				fullScreenOff();
				startTimers();
			}
	
			$('.section-video').addClass('none');
			$('.section-form').removeClass('none');
		}
	} else if (document.querySelector('#videoContainer')) {
		// type 3

		const videoContainer = document.getElementById("videoContainer");
        const video = document.getElementById("video");
        const overlay = document.getElementById("videoOverlay");
        const orderForm = document.querySelector(".form-product");
        let videoStarted = false;
        
        video.addEventListener("ended", handleVideoEnd);

        // Обработчик клика по оверлею
        overlay.addEventListener("click", function () {
          if (!videoStarted) {

            videoStarted = true;
  
            videoContainer.classList.add("fullscreen");
            document.body.classList.add("no-scroll");
  
            video.muted = false;
            video.currentTime = 0;
            video.play();
  
            overlay.style.display = "none";
          }
        });

        video.addEventListener("click", () => {

          if (videoStarted) {
            videoStarted = false;
  
            videoContainer.classList.remove("fullscreen");
            document.body.classList.remove("no-scroll");
            overlay.style.display = "";
  
            video.muted = true;
  
            // if (isOrderPopup && isOrderPopupReady) {
            if (isOrderPopup) {
				showOrderPopup();
			}
          }
        })

        // Функция обработки окончания видео
        function handleVideoEnd() {
          if (!videoStarted) return;

          videoContainer.classList.remove("fullscreen");
          videoContainer.classList.add("d-none");
          document.body.classList.remove("no-scroll");
          video.muted = true;
          overlay.style.display = "flex";

          orderForm.classList.remove("d-none");

          video.removeEventListener("ended", handleVideoEnd);
          videoStarted = false;
        }
	} else if (document.querySelector('.video-container')) {
		// type 4 / alter t1

		$('.order-form__time').addClass('timer');
		document.querySelector('.video-container__play').addEventListener('click', () => {
			window.scrollTo(0, 0)
			$('.video-container__play').fadeOut('fast', function() {
				if (isFP) {
					isFP = false;
					$('.video-container__video').prop('muted', false).prop('currentTime', 0).trigger('play')
				} else {
					$('.video-container__video').prop('muted', false).trigger('play')
				}
				// $('.video-container__video').prop('muted', false).prop('currentTime', 999999999).trigger('play');
				$('.video-container').addClass('fullscreen');
				$('body').addClass('noscroll');
				$('.video-container__close').fadeIn();
				showPlay = false;
			})
		})
		const isOV = document.querySelector('.video-container__open') ? true : false;
		if (isOV) {
			document.querySelector('.video-container__open').addEventListener('click', () => {
				window.scrollTo(0, 0)
				$('.video-container__open').fadeOut('fast', function() {
					if (isFP) {
						isFP = false;
						$('.video-container__video').prop('muted', false).prop('currentTime', 0).trigger('play')
					} else {
						$('.video-container__video').prop('muted', false).trigger('play')
					}
					
					$('.video-container').addClass('fullscreen');
					$('body').addClass('noscroll');
					$('.video-container__close').fadeIn();
					showPlay = false;
				})
			})
		}

		if (isOrderPopup) {
			if (percent > 0 && percent <= 100) {
				$('.video-container__video').on('timeupdate', (e) => {
					if (percent != 100 && e.target.currentTime / e.target.duration >= (percent / 100)) {
						isOrderPopupReady = true;

					} else {
						isOrderPopupReady = false;
					}
				});
			} else {
				isOrderPopupReady = true;
			}
		}
	
		$('.video-container__video').on('ended', showOrder);
	
		$('.video-container__close').on('click', function() {
			$(this).hide();
			// $('.video-container__video').prop('muted', true);
			$('.video-container__video').prop('muted', false);
			$('.video-container').removeClass('fullscreen');
			$('body').removeClass('noscroll');
			if (isOV) 
				$('.video-container__open').fadeIn('fast');
			else
				$('.video-container__play').fadeIn('fast');
			$('#popup').fadeOut('fast');
			if (isOrderPopup && isOrderPopupReady) {
				showOrderPopup();
			}
		});
	
		function showOrder() {
			$('.video-container').removeClass('fullscreen');
			$('body').removeClass('noscroll');
			$('.video-container__close').fadeOut();
			if (isOV) 
				$('.video-container__open').fadeOut();
			else
				$('.video-container__play').fadeOut();
			$('.video-container__video').fadeOut('fast', function() {
				$(this).trigger('pause');
				$('.order-form').fadeIn('fast', function() {
					$('html, body').animate({ scrollTop: $('.order-form').offset().top-20 }, 200);
				})
			})
			startTimers()
		}
	} else if (document.querySelector('#video-container')) {
		// type 5
		$('.timer-display').addClass('timer');
		let video = document.querySelector('#video-player');
		document.querySelector('#video-overlay').addEventListener('click', () => {
			window.scrollTo(0, 0)
			$('#video-overlay').fadeOut('fast', function() {
				if (isFP) {
					isFP = false;
					$(video).prop('muted', false).prop('currentTime', 0).trigger('play');
				} else {
					$(video).prop('muted', false).trigger('play');
				}
				// $(video).prop('muted', false).prop('currentTime', 999999999).trigger('play');
				$('#video-container').addClass('video-fullscreen');
				// $('body').addClass('noscroll');
				$('#close-fullscreen-btn').fadeIn();
				showPlay = false;
			})
		})

		if (isOrderPopup) {
			if (percent > 0 && percent <= 100) {
				$(video).on('timeupdate', (e) => {
					if (percent != 100 && e.target.currentTime / e.target.duration >= (percent / 100)) {
						isOrderPopupReady = true;

					} else {
						isOrderPopupReady = false;
					}
				});
			} else {
				isOrderPopupReady = true;
			}
		}
	
		$(video).on('ended', showOrder);
	
		$('#close-fullscreen-btn').on('click', function() {
			$(this).hide();
			// $(video).prop('muted', true);
			$(video).prop('muted', false);
			$('#video-container').removeClass('video-fullscreen');
			// $('body').removeClass('noscroll');
			$('#video-overlay').fadeIn('fast');
			$('#popup').fadeOut('fast');
			if (isOrderPopup && isOrderPopupReady) {
				showOrderPopup();
			}
		});
	
		function showOrder() {
			$('#video-container').removeClass('video-fullscreen');
			// $('body').removeClass('noscroll');
			$('#close-fullscreen-btn').fadeOut();
			$('#video-overlay').fadeOut();
			$(video).fadeOut('fast', function() {
				$(this).trigger('pause');
				$('#order-form-section').fadeIn('fast', function() {
					$('html, body').animate({ scrollTop: $('#order-form-section').offset().top-20 }, 200);
				})
			})
			startTimers()
		}

	} else {
		console.log('not recognized');
	}


	$('a').on('click', function(e){
		e.preventDefault();
		$('body,html').animate({scrollTop: 100}, 1000);
	})
})

	
function redir() {
	// '{offer}&utm_creative={utm_creative}&adset_id={{adset.id}}&px={px}&bname={bname}&idaa={idaa}&ad_id={ad_id}&klo={klo}'
	window.location.href = link ?? '';
}

function showOrderPopup() {
	$('#order_popup').fadeIn();
	startTimers();
}

function closeOrderPopup() {
	$('#order_popup').fadeOut();
}

$('#order_popup .close_order_popup').click(() => {
	closeOrderPopup();
})

let started = false;
function startTimers() {
	if (started) {
		return;
	} else {
		started = true;
	}
    const timers = document.querySelectorAll('.timer');
	if (timers.length > 0) {
		timers.forEach(timer => {
			let [minutes, seconds] = [10, 0];
			let totalSeconds = minutes * 60 + seconds;
			const updateTimer = () => {
				if (totalSeconds <= 0) {
					timer.textContent = '0:00';
					return;
				}
				totalSeconds--;
				const newMinutes = Math.floor(totalSeconds / 60);
				const newSeconds = totalSeconds % 60;
				timer.textContent = `${newMinutes}:${newSeconds < 10 ? '0' : ''}${newSeconds}`;
			};
			updateTimer();
			setInterval(updateTimer, 1000);
		});
	} else {
		const minutesCont = document.querySelectorAll('.minutes'), secondsCont = document.querySelectorAll('.seconds');
		if (minutesCont.length > 0 && secondsCont.length > 0 && minutesCont.length == secondsCont.length) {
			let [minutes, seconds] = [10, 0];
			let totalSeconds = minutes * 60 + seconds;

			const updateTimer = () => {
				if (totalSeconds <= 0) {
					timer.textContent = '0:00';
					return;
				}
				totalSeconds--;
				const newMinutes = Math.floor(totalSeconds / 60);
				const newSeconds = totalSeconds % 60;
				// timer.textContent = `${newMinutes}:${newSeconds < 10 ? '0' : ''}${newSeconds}`;
				minutesCont.forEach(m => {
					m.textContent = `${newMinutes < 10 ? '0' : ''}${newMinutes}`;
				})
				secondsCont.forEach(s => {
					s.textContent = `${newSeconds < 10 ? '0' : ''}${newSeconds}`;
				})
			};
			updateTimer();
			setInterval(updateTimer, 1000);
		}
	}
}
// ── Универсальный обработчик mute-кнопки (data-video-mute="1") ───────────
const muteBtn = document.querySelector('[data-video-mute="1"]');
if (muteBtn) {
	const videoEl = document.querySelector('video');
	muteBtn.addEventListener('click', function () {
		if (!videoEl) return;
		videoEl.muted = !videoEl.muted;
		muteBtn.setAttribute('data-muted', videoEl.muted ? '1' : '0');
	});
}

// ── Оверлей-элементы: сохранить z-index при fullscreen ───────────────────
// Элементы с data-video-overlay="1" получают position:relative z-index выше видео
document.querySelectorAll('[data-video-overlay="1"]').forEach(function (el) {
	el.style.position = el.style.position || 'absolute';
	el.style.zIndex = el.style.zIndex || '10';
});