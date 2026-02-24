#!/bin/bash

# PM2 프로세스 이름 설정
APP_NAME="marine-server"
ENTRY_POINT="server.js"

echo "=========================================="
echo "🔄 $APP_NAME 서버 관리 스크립트"
echo "=========================================="

# PM2 설치 여부 확인
if ! command -v pm2 &> /dev/null; then
    echo "⚠️  PM2가 설치되어 있지 않습니다. npm start로 시작합니다."
    npm start
    exit 0
fi

# 프로세스 상태 확인 후 재시작 또는 시작
if pm2 describe $APP_NAME > /dev/null 2>&1; then
    echo "♻️  기존 프로세스($APP_NAME)를 재시작합니다..."
    pm2 restart $APP_NAME
else
    echo "🚀 새 프로세스($APP_NAME)를 시작합니다..."
    pm2 start $ENTRY_POINT --name $APP_NAME
fi

# 설정 저장 (서버 재부팅 시 자동 시작 대비)
pm2 save

echo "------------------------------------------"
echo "✅ 작업 완료. 현재 프로세스 상태:"
pm2 status $APP_NAME
echo "=========================================="
