#!/bin/bash
set -e # 오류 발생 시 즉시 중단

# --- 설정 ---
SERVER="pi-server"
REMOTE_DIR="~/work/admin"
TEMP_ARCHIVE="admin-deploy.tar.gz"

echo "=========================================="
echo "🚀 Admin Site 배포 시작 -> $SERVER"
echo "=========================================="

# 1. 프로젝트 압축 (node_modules, .next, .git 제외)
# COPYFILE_DISABLE=1: macOS에서 ._ 파일 생성 방지 (tar 경고 해결)
echo "📦 소스 코드 압축 중..."
COPYFILE_DISABLE=1 tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --no-xattrs \
    -czf $TEMP_ARCHIVE .

# 2. 파일 전송
echo "📤 서버로 파일 전송 중 ($SERVER)..."
scp $TEMP_ARCHIVE $SERVER:/tmp/$TEMP_ARCHIVE

# 3. 로컬 압축 파일 삭제
rm $TEMP_ARCHIVE

# 4. 원격지 작업 수행
echo "🛠️  원격 서버에서 배포 작업 수행 중..."
ssh $SERVER "
    # NVM 로드 시도 (Node.js 버전 관리)
    export NVM_DIR=\"\$HOME/.nvm\"
    [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"
    nvm use v24.13.0 || nvm install v24.13.0

    # Node.js 버전 확인
    echo 'Node.js Version:' \
\$(node -v)

    # 폴더가 없으면 생성
    mkdir -p $REMOTE_DIR

    # 압축 해제
    echo '📂 압축 해제 중...'
    tar -xzf /tmp/$TEMP_ARCHIVE -C $REMOTE_DIR
    rm /tmp/$TEMP_ARCHIVE

    cd $REMOTE_DIR

    # 의존성 설치
    echo '📦 의존성 패키지 설치 중 (npm install)...'
    npm install

    # Prisma 클라이언트 생성 (서버 OS에 맞춰 생성)
    echo '🗄️  Prisma Client 생성 중...'
    npx prisma generate

    # Next.js 빌드
    echo '🏗️  Next.js 빌드 중...'
    npm run build

    echo '✅ 배포 준비 완료!'
    
    # PM2 관리
    if command -v pm2 &> /dev/null; then
        echo '🔄 PM2 프로세스 재시작 중...'
        # 기존 프로세스가 있으면 리로드, 없으면 시작
        pm2 reload admin-portal 2>/dev/null || pm2 start npm --name 'admin-portal' -- start -- -p 3100
        pm2 save
        echo '🚀 서비스가 정상적으로 재시작되었습니다.'
    else
        echo '⚠️  PM2가 설치되어 있지 않습니다. (npm install -g pm2)'
        echo '    서버에서 직접 실행하세요: cd $REMOTE_DIR && npm start'
    fi
"

echo "=========================================="
echo "🎉 배포 스크립트 완료"
echo "=========================================="