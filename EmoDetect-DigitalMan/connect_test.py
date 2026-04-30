import requests
import json
import time

# ================= 配置区域 =================
# 🚨 请确认这是你 AutoDL 最新的公网地址
AUTODL_URL = "https://u863554-ae78-309dada8.bjb1.seetacloud.com:8443/v1/chat/completions"
API_KEY = "wyc666"
# ===========================================

print(f"🚀 [阿里云] 正在呼叫 [AutoDL]: {AUTODL_URL} ...")

payload = {
    "model": "Qwen-VL-Chat",
    "messages": [
        {"role": "user", "content": "你好！我是阿里云服务器，我在 /root/emo_detect 文件夹下呼叫你！"}
    ],
    "max_tokens": 100
}

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}"
}

try:
    start_time = time.time()
    # 发送请求 (30秒超时)
    response = requests.post(AUTODL_URL, json=payload, headers=headers, timeout=30)
    end_time = time.time()
    
    duration = end_time - start_time

    if response.status_code == 200:
        result = response.json()
        ai_reply = result['choices'][0]['message']['content']
        print("\n✅ ================= 连接成功！ =================")
        print(f"⏱️  耗时: {duration:.2f} 秒")
        print(f"🤖 AutoDL 回复: {ai_reply}")
        print("===============================================")
    else:
        print(f"\n❌ 连接失败！状态码: {response.status_code}")
        print(f"错误信息: {response.text}")

except Exception as e:
    print(f"\n❌ 发生错误: {str(e)}")

