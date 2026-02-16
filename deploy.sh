#!/bin/bash
set -e # 오류 발생 시 즉시 중단

# --- 설정 ---
SERVER="pi-server"
REMOTE_DIR="~/work/marine"
TEMP_ARCHIVE="marine-deploy.tar.gz"

echo "=========================================="
echo "🚀 Marine Project 배포 시작 -> $SERVER"
echo "=========================================="

# 1. 프로젝트 압축
echo "📦 소스 코드 압축 중..."
# .env 파일은 제외하고 압축합니다. (서버의 환경변수 보호)
COPYFILE_DISABLE=1 tar -czf $TEMP_ARCHIVE --exclude='.env' --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='server.log' --exclude='public/screenshots/*' --no-xattrs .

# 2. 파일 전송
echo "📤 서버로 파일 전송 중 ($SERVER)..."
scp $TEMP_ARCHIVE $SERVER:/tmp/$TEMP_ARCHIVE
# 운영 전용 .env 파일을 별도로 전송합니다.
if [ -f ".env.production" ]; then
    echo "🔑 운영 환경 설정 파일(.env.production) 전송 중..."
    scp .env.production $SERVER:$REMOTE_DIR/.env
fi
echo "✅ 전송 완료"

# 3. 로컬 압축 파일 삭제
rm $TEMP_ARCHIVE

# 4. 원격지 작업 수행
echo "🛠️  원격 서버에서 배포 작업 수행 중..."
ssh $SERVER "
    # 폴더 생성
    mkdir -p $REMOTE_DIR
    mkdir -p $REMOTE_DIR/public/screenshots

    # 압축 해제
    echo '📂 압축 해제 중...'
    tar -xzf /tmp/$TEMP_ARCHIVE -C $REMOTE_DIR
    rm /tmp/$TEMP_ARCHIVE

    cd $REMOTE_DIR

    # NVM 로드 및 Node.js 버전 관리
    export NVM_DIR=\"\$HOME/.nvm\"
    [ -s \"\$NVM_DIR/nvm.sh\" ] && \\. \"\$NVM_DIR/nvm.sh\"
    
    echo '🛠️  Node.js 버전 확인 및 전환 중...'
    nvm use 24 || nvm install 24
    echo \"Node.js Version: \$(node -v)\"

    # 의존성 설치
    echo '📦 의존성 패키지 설치 중 (npm install)...'
    npm install --omit=dev

    echo '✅ 배포 준비 완료!'
    
    # PM2 관리
    if command -v pm2 &> /dev/null; then
        echo '🔄 PM2 프로세스 재시작 중...'
        pm2 reload marine-server 2>/dev/null || pm2 start server.js --name 'marine-server'
        pm2 save
        
        echo '📊 현재 PM2 서비스 상태:'
        pm2 show marine-server
    else
        echo '⚠️  PM2가 설치되어 있지 않습니다.'
    fi
"

echo "=========================================="
echo "🎉 Marine 배포 완료 (포트: 8080)"
echo "=========================================="
