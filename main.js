const lyricsPool = [
            {
                song: "《天外来物》",
                text: "你就像天外来物一样\n求之不得\n我在世俗里的名字\n被人用了\n反正我隐藏的人格\n是锲而不舍"
            },
            {
                song: "《演员》",
                text: "该配合你演出的我\n尽力在表演\n像情感节目里的嘉宾\n任人挑选\n如果还能看出我有\n爱你的那面"
            },
            {
                song: "《丑八怪》",
                text: "丑八怪\n能否别把灯打开\n我要的爱\n出没在漆黑一片的舞台\n丑八怪\n在这暧昧的时代"
            },
            {
                song: "《刚刚好》",
                text: "我们的爱情\n到这刚刚好\n剩不多也不少\n还能忘掉\n我应该可以\n把自己照顾好"
            },
            {
                song: "《认真的雪》",
                text: "雪下得那么深\n下得那么认真\n倒映出我躺在雪中的伤痕\n爱得那么认真\n爱得那么深"
            },
            {
                song: "《绅士》",
                text: "我想摸你的头发\n只是简单的试探啊\n我想给你个拥抱\n像以前一样可以吗\n你退半步的动作\n认真的吗"
            },
            {
                song: "《动物世界》",
                text: "人类用沙\n想捏出梦里通天塔\n为贪念不惜代价\n驾驭着昂贵的木马\n巢穴一层层叠加"
            },
            {
                song: "《方圆几里》",
                text: "我宁愿留在你方圆几里\n我的心要不回就送你\n因为我爱你\n和你没关系"
            },
            {
                song: "《守村人》",
                text: "你看守村的夜晚\n灯忽明忽暗\n最爱你的人\n望眼欲穿\n烟花点不燃\n我没像样的伞"
            },
            {
                song: "《租购》",
                text: "能给她一个\n不管多久都不会变动的家\n收留所有的流浪\n不让她觉得害怕\n这间房住过多少人\n梦过了多少理想"
            },
            {
                song: "《Nothing》",
                text: "I am still waiting for you\nI am still waiting for nothing\nCome back to me\ncome back to me"
            },
            {
                song: "《崇拜》",
                text: "我崇拜\n你回眸一笑就万里火海\n能明白\n我孤独的存在"
            },
            {
                song: "《情书》",
                text: "甘愿签下唯一\n终生制承诺书\n受益名字\n是你也是我的全部\n哪怕非得孤注一掷\n也不愿再辜负一次"
            },
            {
                song: "《顽疾》",
                text: "病历上肆意拉扯\n来回写满\n摊开它给你欣赏\n我的不堪\n可是要治好顽疾\n有多难"
            },
            {
                song: "《平庸》",
                text: "我要用暗淡盖你璀璨的伤\n别回应\n让烟慢慢讲\n烫一个洞\n留一点念想"
            },
          
        ];

        const loadingScreen = document.getElementById('loadingScreen');
        const appShell = document.getElementById('appShell');
        const turntable = document.getElementById('turntable');
        const tonearm = document.getElementById('tonearm');
        const vinyl = document.getElementById('vinylRecord');
        const vinylSheen = document.getElementById('vinylSheen');
        const playButton = document.getElementById('playButton');
        const resultArea = document.getElementById('resultArea');
        const lyricEl = document.getElementById('lyricText');
        const songEl = document.getElementById('songName');
        const btnTextEl = document.getElementById('btnText');
        const contactLink = document.getElementById('contactLink');
        const copyToast = document.getElementById('copyToast');

        const dynamicIsland = document.getElementById('dynamicIsland');
        const playerPillEl = document.getElementById('playerPill');
        const playerToggleBtn = document.getElementById('playerToggleBtn');
        const trackWrap = document.getElementById('trackWrap');
        const trackFill = document.getElementById('trackFill');
        const playerTime = document.getElementById('playerTime');
        const lyricToggleBtn = document.getElementById('lyricToggleBtn');

        let isDrawing = false;
        let lyricAnimations = [];

        const audioEl = document.createElement('audio');
        let isAudioPlaying = false;
        let volumeFadeInterval = null;
        let isDraggingTrack = false;

        const formatAudioTime = (time) => {
            if (isNaN(time)) return '0:00';
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        audioEl.addEventListener('timeupdate', () => {
            if (isDraggingTrack) return;
            const progress = (audioEl.currentTime / audioEl.duration) || 0;
            trackFill.style.width = `${progress * 100}%`;
            playerTime.innerText = formatAudioTime(audioEl.currentTime);
        });

        audioEl.addEventListener('loadedmetadata', () => {
            playerTime.innerText = '0:00';
            trackFill.style.width = '0%';
        });

        audioEl.addEventListener('play', () => {
            playerToggleBtn.classList.remove('is-disabled');
            playerToggleBtn.classList.add('is-playing');
            if (!isDrawing) {
                turntable.classList.add('is-playing');
                spinAnimation.play();
                sheenAnimation.play();
                animateRate({ 
                    from: 0, 
                    to: 0.68, 
                    duration: 1800, 
                    easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 
                });
            }
        });

        audioEl.addEventListener('pause', () => {
            playerToggleBtn.classList.remove('is-playing');
            if (!isDrawing) {
                turntable.classList.remove('is-playing');
                animateRate({ 
                    from: 0.68, 
                    to: 0, 
                    duration: 2500, 
                    easing: (t) => 1 - Math.pow(1 - t, 4) 
                }).then(() => {
                    if (!isAudioPlaying) {
                        spinAnimation.pause();
                        sheenAnimation.pause();
                    }
                });
            }
        });

        audioEl.addEventListener('ended', () => {
            stopAndFadeOutAudio(800);
        });

        const toggleAudioState = (play) => {
            if (play === isAudioPlaying) return;
            isAudioPlaying = play;
            if (volumeFadeInterval) {
                clearInterval(volumeFadeInterval);
                volumeFadeInterval = null;
            }
            if (play) {
                audioEl.volume = 1;
                playerToggleBtn.classList.remove('is-disabled');
                audioEl.play().catch(e => console.log('Audio init pending interaction', e));
                if (!isDrawing) {
                    animateTonearm({
                        from: ARM_REST_ANGLE, 
                        to: ARM_PLAY_ANGLE, 
                        duration: 1200, 
                        easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                    });
                }
            } else {
                stopAndFadeOutAudio(800);
                if (!isDrawing) {
                    animateTonearm({
                        from: ARM_PLAY_ANGLE, 
                        to: ARM_REST_ANGLE, 
                        duration: 1200, 
                        easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                    });
                }
            }
        };

        const stopAndFadeOutAudio = async (duration = 800) => {
            if (audioEl.paused) return;
            if (volumeFadeInterval) clearInterval(volumeFadeInterval);
            playerToggleBtn.classList.add('is-disabled');
            const step = 0.05;
            const ms = Math.max(16, duration * step);
            return new Promise((resolve) => {
                volumeFadeInterval = setInterval(() => {
                    const newVol = Math.max(0, audioEl.volume - step);
                    audioEl.volume = newVol;
                    if (newVol === 0) {
                        clearInterval(volumeFadeInterval);
                        volumeFadeInterval = null;
                        isAudioPlaying = false;
                        audioEl.pause();
                        audioEl.volume = 1;
                        playerToggleBtn.classList.remove('is-disabled');
                        resolve();
                    }
                }, ms);
            });
        };

        playerToggleBtn.addEventListener('click', () => {
            toggleAudioState(!isAudioPlaying);
        });

        const updateAudioTime = (e) => {
            if (!audioEl.duration) return;
            const rect = trackWrap.getBoundingClientRect();
            let clientX = e.clientX;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
            }
            let percent = (clientX - rect.left) / rect.width;
            percent = Math.max(0, Math.min(1, percent));
            audioEl.currentTime = percent * audioEl.duration;
            trackFill.style.width = `${percent * 100}%`;
            playerTime.innerText = formatAudioTime(audioEl.currentTime);
        };

        trackWrap.addEventListener('mousedown', (e) => {
            isDraggingTrack = true;
            trackFill.style.transition = 'none';
            updateAudioTime(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDraggingTrack) updateAudioTime(e);
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingTrack) {
                isDraggingTrack = false;
                trackFill.style.transition = '';
            }
        });

        trackWrap.addEventListener('touchstart', (e) => {
            isDraggingTrack = true;
            trackFill.style.transition = 'none';
            updateAudioTime(e);
        }, {passive: true});

        window.addEventListener('touchmove', (e) => {
            if (isDraggingTrack) updateAudioTime(e);
        }, {passive: false});

        window.addEventListener('touchend', () => {
            if (isDraggingTrack) {
                isDraggingTrack = false;
                trackFill.style.transition = '';
            }
        });

        contactLink.addEventListener('click', () => {
            const wechatId = 'Michael_Yuuu';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(wechatId).then(() => {
                    showToast();
                }).catch(() => {
                    prompt('请手动长按复制我的微信号:', wechatId);
                });
            } else {
                prompt('请手动长按复制我的微信号:', wechatId);
            }
        });

        const showToast = () => {
            copyToast.classList.add('is-visible');
            setTimeout(() => {
                copyToast.classList.remove('is-visible');
            }, 2500);
        };

        const updateButtonText = async (newText) => {
            if (btnTextEl.innerText === newText) return;
            btnTextEl.classList.add('is-switching');
            await wait(300);
            btnTextEl.innerText = newText;
            btnTextEl.classList.remove('is-switching');
            await wait(300);
        };

        const runLoadingSequence = async () => {
            const loadingSources = ['cover/3.jpg', 'cover/4.jpg', 'cover/1.jpg', 'cover/2.jpg', 'cover/天外来物.jpg'];

            // Just wait 2.2s to show the hole animation
            await wait(2200);

            const holeLoader = document.getElementById('holeLoader');
            const loadingCopy = document.getElementById('loadingCopy');
            const loadingHeroWrap = document.getElementById('loadingHeroWrap');
            const loadingAmbient = document.getElementById('loadingAmbient');
            const slides = document.querySelectorAll('.loading-slide');
            
            // 隐藏波纹和文字
            if (holeLoader) holeLoader.classList.add('is-hidden');
            if (loadingCopy) loadingCopy.textContent = '信号已接入';

            await wait(400); // 留一点呼吸感时间

            if (loadingHeroWrap) loadingHeroWrap.classList.add('is-loaded');
            if (loadingAmbient) loadingAmbient.classList.add('is-loaded');
            if (loadingCopy) loadingCopy.classList.add('is-hidden');

            let currentIndex = 0;
            const updateSlide = () => {
                if (slides.length > 0) {
                    slides.forEach((slide, idx) => {
                        if (idx === currentIndex) slide.classList.add('is-active');
                        else slide.classList.remove('is-active');
                    });
                    if (loadingAmbient) {
                        loadingAmbient.style.backgroundImage = `url(${loadingSources[currentIndex]})`;
                    }
                }
            };
            
            updateSlide(); // 首张图

            // 每张图片驻留 2.2 秒
            let slideInterval = setInterval(() => {
                currentIndex++;
                if (currentIndex >= 4) {
                    clearInterval(slideInterval);
                    // 循环完毕后，优雅退出加载页，进入主页
                    setTimeout(() => {
                        loadingScreen.classList.add('is-exiting');
                        appShell.classList.add('is-ready');
                    }, 1000); 
                    return;
                }
                updateSlide();
            }, 2200);
        };

        if (document.readyState === 'complete') {
            runLoadingSequence();
        } else {
            window.addEventListener('load', runLoadingSequence);
        }

        loadingScreen.addEventListener('transitionend', (event) => {
            if (event.propertyName === 'opacity') {
                loadingScreen.remove();
            }
        }, { once: true });

        const spinAnimation = vinyl.animate([
            { transform: 'translateZ(0) rotate(0deg)' },
            { transform: 'translateZ(0) rotate(360deg)' }
        ], {
            duration: 14000,
            iterations: Infinity,
            easing: 'linear'
        });
        spinAnimation.playbackRate = 0;
        spinAnimation.pause();

        // 极弱反光层：常态低速，提速阶段增强，减速后回归克制。
        const sheenAnimation = vinylSheen.animate([
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(360deg)' }
        ], {
            duration: 7000,
            iterations: Infinity,
            easing: 'linear'
        });
        sheenAnimation.playbackRate = 0.16;
        sheenAnimation.pause();

        const updateSheenByRate = (rate) => {
            const clamped = Math.max(0, Math.min(5.2, rate));
            const normalized = clamped / 5.2;
            const opacity = 0.03 + normalized * 0.1;
            const sheenRate = 0.08 + normalized * 1.1;
            vinylSheen.style.opacity = opacity.toFixed(3);
            sheenAnimation.playbackRate = sheenRate;
        };

        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

        const ARM_REST_ANGLE = -96;
        const ARM_PLAY_ANGLE = -34;

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const setTonearmAngle = (angle) => {
            tonearm.style.setProperty('--arm-angle', `${angle.toFixed(2)}deg`);
        };

        setTonearmAngle(ARM_REST_ANGLE);

        const animateTonearm = ({ from, to, duration, easing }) => new Promise((resolve) => {
            const startTime = performance.now();

            const frame = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easing(progress);
                const currentAngle = from + (to - from) * eased;
                setTonearmAngle(currentAngle);

                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    resolve();
                }
            };

            requestAnimationFrame(frame);
        });

        const animateRate = ({ from, to, duration, easing }) => new Promise((resolve) => {
            const startTime = performance.now();

            const frame = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easing(progress);
                const currentRate = from + (to - from) * eased;

                spinAnimation.playbackRate = currentRate;
                updateSheenByRate(currentRate);

                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    resolve();
                }
            };

            requestAnimationFrame(frame);
        });

        const lyricToLinesHTML = (text) => {
            const lines = text
                .split(/\n|[，。！？；]/)
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 8);

            return lines.map((line) => `<span class="lyric-line">${line}</span>`).join('');
        };

        const resetResultVisual = () => {
            lyricAnimations.forEach((anim) => anim.cancel());
            lyricAnimations = [];
            resultArea.classList.remove('is-visible');
            resultArea.style.opacity = '0';
            resultArea.style.transform = 'translateY(18px) scale(1.01)';
            lyricEl.style.opacity = '0';
            lyricEl.style.transform = 'translateY(20px)';
            songEl.style.opacity = '0';
            songEl.style.transform = 'translateY(20px)';
            // player-pill 现在在外部独立管理显示
        };

        const animateLyricIn = () => {
            resultArea.classList.add('is-visible');
            dynamicIsland.classList.add('is-split');

            const cardAnim = resultArea.animate([
                { opacity: 0, transform: 'translateY(28px) scale(0.98)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], {
                duration: 1200,
                fill: 'forwards',
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
            });

            const lyricAnim = lyricEl.animate([
                { opacity: 0, transform: 'translateY(24px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 1000,
                fill: 'forwards',
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
            });

            const songAnim = songEl.animate([
                { opacity: 0, transform: 'translateY(24px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 900,
                delay: 260,
                fill: 'forwards',
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
            });

            const lineAnimations = Array.from(lyricEl.querySelectorAll('.lyric-line')).map((line, index) => line.animate([
                { opacity: 0, transform: 'translateY(18px) scale(0.98)', filter: 'blur(8px)' },
                { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
            ], {
                duration: 850,
                delay: 150 + index * 85,
                fill: 'forwards',
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
            }));

            lyricAnimations = [cardAnim, lyricAnim, songAnim, ...lineAnimations];
        };

        const morphResultOut = () => {
            return resultArea.animate([
                { opacity: 1, transform: 'translateY(0) scale(1)' },
                { opacity: 0, transform: 'translateY(16px) scale(1.008)' }
            ], {
                duration: 540,
                fill: 'forwards',
                easing: 'cubic-bezier(0.45, 0, 0.55, 1)'
            }).finished;
        };

        resultArea.addEventListener('click', async () => {
            if (isDrawing || !resultArea.classList.contains('is-visible')) return;
            isDrawing = true;
            playButton.disabled = true;

            const textUpdatePromise = updateButtonText('再次抽取');

            await morphResultOut();
            resetResultVisual();

            await textUpdatePromise;
            playButton.disabled = false;
            isDrawing = false;
            
            // 显示“显示歌词”悬浮按钮
            lyricToggleBtn.classList.add('is-visible');
        });

        lyricToggleBtn.addEventListener('click', () => {
            if (isDrawing) return;
            lyricToggleBtn.classList.remove('is-visible');
            animateLyricIn();
        });

        playButton.addEventListener('click', async () => {
            if (isDrawing) return;
            isDrawing = true;
            playButton.disabled = true;
            
            lyricToggleBtn.classList.remove('is-visible');

            const textUpdatePromise = updateButtonText('读取中');

            let initialArmAngle = ARM_REST_ANGLE;
            let initialRate = 0;
            
            const cleanupTasks = [];

            if (resultArea.classList.contains('is-visible')) {
                cleanupTasks.push(morphResultOut());
            }

            if (isAudioPlaying) {
                initialArmAngle = ARM_PLAY_ANGLE;
                initialRate = 0.68;
                cleanupTasks.push(stopAndFadeOutAudio(500));
            }

            await Promise.all(cleanupTasks);
            
            dynamicIsland.classList.remove('is-split');

            resetResultVisual();
            turntable.classList.add('is-playing');

            spinAnimation.play();
            sheenAnimation.play();

            // 点击即瞬时提速。
            const maxRate = 5.2;

            await Promise.all([
                textUpdatePromise,
                animateTonearm({
                    from: initialArmAngle,
                    to: ARM_REST_ANGLE, 
                    duration: 1100,
                    easing: easeInOutCubic
                }),
                animateRate({
                    from: initialRate,
                    to: maxRate,
                    duration: 1400,
                    easing: easeInOutSine
                })
            ]);

            await wait(1200);

            const randomIndex = Math.floor(Math.random() * lyricsPool.length);
            const result = lyricsPool[randomIndex];

            lyricEl.innerHTML = lyricToLinesHTML(result.text);
            songEl.innerText = '—— ' + result.song;

            toggleAudioState(false);
            const audioFileName = result.song.replace(/[《》]/g, '') + '.mp3';
            audioEl.src = 'musics/' + encodeURIComponent(audioFileName);
            audioEl.load();

            // 同步点：减速启动与文字浮现在同一事件循环触发。
            animateLyricIn();
            toggleAudioState(true);
            
            await Promise.all([
                updateButtonText('再次抽取'),
                animateTonearm({
                    from: ARM_REST_ANGLE,
                    to: ARM_PLAY_ANGLE, 
                    duration: 1820,
                    easing: easeInOutCubic
                }),
                animateRate({
                    from: maxRate,
                    to: 0.68,
                    duration: 1820,
                    easing: easeInOutCubic
                })
            ]);

            await wait(900);

            // 如果不再需要后续多余的唱臂回落（前面已经放上去了），这里只管把状态维护正确即可
            // 或者仅仅做微小的阻尼修正
            await Promise.all([
                animateTonearm({
                    from: ARM_PLAY_ANGLE,
                    to: isAudioPlaying ? ARM_PLAY_ANGLE : ARM_REST_ANGLE,
                    duration: 920,
                    easing: easeInOutCubic
                }),
                animateRate({
                    from: 0.68,
                    to: isAudioPlaying ? 0.68 : 0,
                    duration: 1200,
                    easing: easeOutQuart
                })
            ]);

            if (!isAudioPlaying) {
                spinAnimation.pause();
                sheenAnimation.pause();
                turntable.classList.remove('is-playing');
            }
            playButton.disabled = false;
            isDrawing = false;
        });
