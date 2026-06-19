# 들임 Deulim CAD

실제 치수를 기준으로 집을 직접 그리고, 같은 도면을 즉시 3D 공간으로 확인하는 경량 CAD 프로토타입입니다.

## 실행

```powershell
cd "$HOME\Desktop\deulim"
npm install
npm run dev
```

터미널에 표시되는 로컬 주소를 브라우저에서 엽니다. 현재 기본 주소는 `http://127.0.0.1:5174`입니다.

## 주요 조작

- `벽 그리기`: 빈 캔버스를 연속 클릭하고 시작점에 붙여 방을 닫습니다.
- `Shift`: 벽을 수평 또는 수직으로 고정합니다.
- `Enter` 또는 더블클릭: 열린 벽 그리기를 완료합니다.
- `Escape`: 현재 그리기나 드래그를 취소합니다.
- `Delete`: 선택한 벽, 문, 창문, 가구를 삭제합니다.
- 3D 뷰 드래그/휠: 회전하고 확대합니다. 도면 편집 중에도 카메라 위치가 유지됩니다.

## 검증

```powershell
npm run lint
npm run build
npm run test:e2e
```
