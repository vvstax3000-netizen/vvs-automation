@echo off
chcp 65001 >nul
title VVS Marketing Automation - Cloudflare 배포

echo.
echo ============================================
echo   VVS Marketing Automation 배포 스크립트
echo   Cloudflare Workers + Pages + D1
echo ============================================
echo.

REM ──────────────────────────────────────────
REM  1단계: Node.js 확인
REM ──────────────────────────────────────────
echo [1/8] Node.js 설치 확인 중...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ Node.js가 설치되어 있지 않습니다!
    echo    https://nodejs.org 에서 설치 후 다시 실행해주세요.
    pause
    exit /b 1
)
echo ✅ Node.js 확인 완료
echo.

REM ──────────────────────────────────────────
REM  2단계: Worker 패키지 설치
REM ──────────────────────────────────────────
echo [2/8] Worker 패키지 설치 중...
cd /d "%~dp0worker"
call npm install
if %errorlevel% neq 0 (
    echo ❌ 패키지 설치 실패
    pause
    exit /b 1
)
echo ✅ Worker 패키지 설치 완료
echo.

REM ──────────────────────────────────────────
REM  3단계: Cloudflare 로그인
REM ──────────────────────────────────────────
echo [3/8] Cloudflare 로그인
echo.
echo    ※ 브라우저가 자동으로 열립니다.
echo    ※ Cloudflare 계정이 없다면 먼저 가입해주세요.
echo    ※ 로그인 완료 후 이 창으로 돌아오세요.
echo.
call npx wrangler login
if %errorlevel% neq 0 (
    echo.
    echo ❌ 로그인 실패 - 다시 시도해주세요
    pause
    exit /b 1
)
echo.
echo ✅ Cloudflare 로그인 완료!
echo.

REM ──────────────────────────────────────────
REM  4단계: D1 데이터베이스 생성
REM ──────────────────────────────────────────
echo [4/8] D1 데이터베이스 생성 중...
echo.
call npx wrangler d1 create vvs-db 2>d1_output_err.txt >d1_output.txt
type d1_output.txt
echo.
echo ──────────────────────────────────────────
echo   ⚠️  중요! 위 출력에서 database_id를 복사해주세요.
echo   아래처럼 생긴 값입니다:
echo   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
echo ──────────────────────────────────────────
echo.
set /p DB_ID="database_id 값을 붙여넣기 하세요 (따옴표 없이): "

if "%DB_ID%"=="" (
    echo ❌ database_id를 입력해야 합니다!
    pause
    exit /b 1
)

echo.
echo 입력된 ID: %DB_ID%
echo.

REM wrangler.toml 업데이트
powershell -Command "(Get-Content 'wrangler.toml') -replace 'database_id = \"\"', 'database_id = \"%DB_ID%\"' | Set-Content 'wrangler.toml'"
echo ✅ wrangler.toml에 database_id 저장 완료
echo.

REM ──────────────────────────────────────────
REM  5단계: D1 마이그레이션 (테이블 생성)
REM ──────────────────────────────────────────
echo [5/8] D1 데이터베이스 테이블 생성 중...
call npx wrangler d1 migrations apply vvs-db --remote
if %errorlevel% neq 0 (
    echo ❌ 마이그레이션 실패
    pause
    exit /b 1
)
echo ✅ 데이터베이스 테이블 생성 완료
echo.

REM ──────────────────────────────────────────
REM  6단계: Worker 배포
REM ──────────────────────────────────────────
echo [6/8] Cloudflare Worker 배포 중...
call npx wrangler deploy
if %errorlevel% neq 0 (
    echo ❌ Worker 배포 실패
    pause
    exit /b 1
)
echo.
echo ✅ Worker 배포 완료!
echo.
echo ──────────────────────────────────────────
echo   ⚠️  위 출력에서 Worker URL을 확인해주세요.
echo   예: https://vvs-api.xxxxx.workers.dev
echo ──────────────────────────────────────────
echo.
set /p WORKER_URL="Worker URL을 붙여넣기 하세요: "

if "%WORKER_URL%"=="" (
    echo ❌ Worker URL을 입력해야 합니다!
    pause
    exit /b 1
)

REM ──────────────────────────────────────────
REM  7단계: 프론트엔드 빌드
REM ──────────────────────────────────────────
echo.
echo [7/8] 프론트엔드 빌드 중...
cd /d "%~dp0frontend"

REM .env.production 업데이트
echo VITE_API_URL=%WORKER_URL%> .env.production

call npm install
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 프론트엔드 빌드 실패
    pause
    exit /b 1
)
echo ✅ 프론트엔드 빌드 완료 (dist 폴더)
echo.

REM ──────────────────────────────────────────
REM  8단계: Cloudflare Pages 배포
REM ──────────────────────────────────────────
echo [8/8] Cloudflare Pages에 프론트엔드 배포 중...
call npx wrangler pages project create vvs-frontend --production-branch main 2>nul
call npx wrangler pages deploy dist --project-name vvs-frontend
if %errorlevel% neq 0 (
    echo ❌ Pages 배포 실패
    pause
    exit /b 1
)

echo.
echo ============================================
echo   🎉 배포 완료!
echo ============================================
echo.
echo   백엔드 (Worker): %WORKER_URL%
echo   프론트엔드 (Pages): https://vvs-frontend.pages.dev
echo.
echo   ※ 관리자 로그인: admin / admin1234
echo   ※ 매일 15:00 KST에 순위 자동 업데이트
echo   ※ 24시간 운영 (PC 안 켜도 됨!)
echo.
echo ============================================

REM 임시 파일 정리
cd /d "%~dp0worker"
del /q d1_output.txt 2>nul
del /q d1_output_err.txt 2>nul

pause
