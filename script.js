document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const imageContainer = document.getElementById('imageContainer');

    // Azure 配置
    const visionEndpoint = "https://fiykhnui.cognitiveservices.azure.com/";
    const visionKey = config.visionKey;  // 使用配置文件中的密钥
    const translatorEndpoint = "https://api.cognitive.microsofttranslator.com/";
    const translatorKey = config.translatorKey;  // 使用配置文件中的密钥

    // 处理拖拽上传
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.background = '#F0F0F0';
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.style.background = 'white';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.background = 'white';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleImage(files[0]);
        }
    });

    // 处理点击上传
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImage(e.target.files[0]);
        }
    });

    async function handleImage(file) {
        if (!file.type.startsWith('image/')) {
            alert('请上传图片文件');
            return;
        }

        try {
            showLoading();
            const imageUrl = await readFileAsDataURL(file);
            const img = new Image();
            img.src = imageUrl;
            
            img.onload = async () => {
                imageContainer.innerHTML = '';
                imageContainer.appendChild(img);
                
                try {
                    console.log('开始处理图片...');
                    const imageBlob = await fetch(imageUrl).then(r => r.blob());
                    const objects = await detectObjects(imageBlob);
                    
                    console.log('识别结果数量:', objects.length);
                    
                    if (!objects || objects.length === 0) {
                        console.log('未检测到物体');
                        alert('未能识别出图片中的物体，请尝试上传其他图片');
                        hideLoading();
                        return;
                    }

                    // 处理识别结果
                    for (const obj of objects) {
                        console.log('正在处理物体:', obj);
                        
                        if (!obj || typeof obj.object !== 'string') {
                            console.log('跳过无效物体数据');
                            continue;
                        }

                        try {
                            const word = obj.object.trim();
                            console.log('处理单词:', word);
                            
                            const translation = await translateWord(word, 'en', 'zh-Hans');
                            console.log(`翻译结果 ${word} -> ${translation}`);
                            
                            addAnnotation({
                                word: word,
                                phonetic: `/${word}/`,
                                chinese: translation,
                                position: obj.rectangle
                            });
                        } catch (translationError) {
                            console.error('翻译错误:', translationError);
                            // 即使翻译失败，也显示英文标签
                            addAnnotation({
                                word: obj.object,
                                phonetic: `/${obj.object}/`,
                                chinese: '翻译失败',
                                position: obj.rectangle
                            });
                        }
                    }
                } catch (error) {
                    console.error('处理错误:', error);
                    alert('图片处理出错：' + error.message);
                } finally {
                    hideLoading();
                }
            };
        } catch (error) {
            hideLoading();
            console.error('Error:', error);
            alert('图片处理失败，请重试');
        }
    }

    async function detectObjects(imageBlob) {
        const url = `${visionEndpoint}computervision/imageanalysis:analyze?api-version=2023-02-01-preview&features=objects,tags`;
        
        try {
            console.log('开始调用 Vision API...');
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Ocp-Apim-Subscription-Key': visionKey
                },
                body: imageBlob
            });

            console.log('API 响应状态:', response.status);
            const result = await response.json();
            console.log('API 完整响应:', result);

            let detectedObjects = [];
            
            if (result.objectsResult && result.objectsResult.values) {
                console.log('原始物体数据:', result.objectsResult.values);
                
                detectedObjects = result.objectsResult.values.map(obj => {
                    console.log('处理单个物体数据:', obj);
                    
                    // 获取物体名称
                    let objectName = 'unknown object';
                    if (obj.tags && obj.tags.length > 0) {
                        objectName = typeof obj.tags[0] === 'object' ? obj.tags[0].name : obj.tags[0];
                    } else if (typeof obj.name === 'string') {
                        objectName = obj.name;
                    } else if (obj.name && obj.name.name) {
                        objectName = obj.name.name;
                    }
                    
                    objectName = String(objectName);
                    console.log('提取的物体名称:', objectName);
                    
                    // 修改这里：直接使用原始坐标值，不做转换
                    return {
                        object: objectName,
                        rectangle: {
                            x: obj.boundingBox.x,
                            y: obj.boundingBox.y,
                            width: obj.boundingBox.w,
                            height: obj.boundingBox.h
                        }
                    };
                });
            }

            // 如果没有检测到物体，尝试使用标签
            if ((detectedObjects.length === 0 || detectedObjects.every(obj => obj.object === 'unknown object')) 
                && result.tagsResult && result.tagsResult.values) {
                console.log('使用标签作为备选:', result.tagsResult.values);
                detectedObjects = result.tagsResult.values
                    .filter(tag => tag.confidence > 0.5)
                    .map((tag, index) => ({
                        object: tag.name,
                        rectangle: {
                            x: 0.1 + (index * 0.2),
                            y: 0.1 + (index * 0.2),
                            width: 0.2,
                            height: 0.2
                        }
                    }));
            }

            // 打印最终结果
            console.log('最终处理结果:', detectedObjects);
            
            // 过滤掉未知物体
            detectedObjects = detectedObjects.filter(obj => obj.object !== 'unknown object');
            
            if (detectedObjects.length === 0) {
                console.log('没有识别出有效物体，尝试使用图片标签');
                // 使用图片整体标签作为备选
                if (result.tagsResult && result.tagsResult.values) {
                    detectedObjects = result.tagsResult.values
                        .filter(tag => tag.confidence > 0.6)  // 提高置信度阈值
                        .slice(0, 3)  // 最多取前3个标签
                        .map((tag, index) => ({
                            object: tag.name,
                            rectangle: {
                                x: 0.2 + (index * 0.3),  // 在图片上均匀分布
                                y: 0.5,
                                width: 0.2,
                                height: 0.2
                            }
                        }));
                }
            }

            return detectedObjects;
        } catch (error) {
            console.error('Vision API 详细错误:', error);
            throw error;
        }
    }

    async function translateWord(word, fromLang, toLang) {
        const url = `${translatorEndpoint}translate?api-version=3.0&from=${fromLang}&to=${toLang}`;
        
        try {
            console.log('翻译单词:', word);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key': translatorKey,
                    'Ocp-Apim-Subscription-Region': 'eastus'
                },
                body: JSON.stringify([{
                    text: word
                }])
            });

            if (!response.ok) {
                console.error('翻译API响应状态:', response.status);
                console.error('翻译API响应头:', Object.fromEntries(response.headers.entries()));
                throw new Error(`翻译API调用失败: ${response.status}`);
            }

            const result = await response.json();
            console.log('翻译API响应:', result);
            return result[0]?.translations[0]?.text || word;
        } catch (error) {
            console.error('翻译API错误:', error);
            return `${word} (翻译失败)`;
        }
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function addAnnotation({ word, phonetic, chinese, position }) {
        const annotation = document.createElement('div');
        annotation.className = 'word-annotation';
        
        // 获取图片元素
        const img = imageContainer.querySelector('img');
        if (!img) return;

        // 计算实际坐标（考虑图片的实际显示尺寸）
        const imgRect = img.getBoundingClientRect();
        const containerRect = imageContainer.getBoundingClientRect();
        
        // 计算图片的缩放比例
        const scaleX = imgRect.width / img.naturalWidth;
        const scaleY = imgRect.height / img.naturalHeight;
        
        // 计算标注的实际位置
        const x = (position.x * scaleX) / imgRect.width * 100;
        const y = (position.y * scaleY) / imgRect.height * 100;
        
        console.log('标注位置计算:', {
            原始位置: position,
            图片尺寸: {
                natural: { width: img.naturalWidth, height: img.naturalHeight },
                display: { width: imgRect.width, height: imgRect.height }
            },
            计算后位置: { x, y }
        });
        
        // 设置标注位置
        annotation.style.left = `${x}%`;
        annotation.style.top = `${y}%`;
        
        annotation.innerHTML = `
            <div class="word-english">${word}</div>
            <div class="word-phonetic">${phonetic}</div>
            <div class="word-chinese">${chinese}</div>
        `;

        annotation.addEventListener('click', () => {
            speakWord(word);
        });

        imageContainer.appendChild(annotation);
    }

    function showLoading() {
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.id = 'loadingIndicator';
        loading.innerHTML = 'AI正在识别图片中...';
        document.body.appendChild(loading);
    }

    function hideLoading() {
        const loading = document.getElementById('loadingIndicator');
        if (loading) {
            loading.remove();
        }
    }

    // 添加单词发音功能
    function speakWord(word) {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    }
}); 