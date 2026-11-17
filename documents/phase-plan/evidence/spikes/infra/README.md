# P00-T03 — spike hạ tầng độc lập

Đây là môi trường nghiên cứu **dùng dữ liệu giả**, không phải Compose phát hành Nexora. `upstream.py` chỉ trả 200/202 để thử các route gateway. `core_spike.py` là service headless có PostgreSQL riêng để kiểm ranh giới runtime, **không** phải Core Data/File API sản phẩm và không dùng schema/policy/file scanning của P03. File `render.py` sinh credential ngẫu nhiên vào `generated/` bị Git bỏ qua; không dùng các credential này ngoài máy thử.

## Tái lập trên PowerShell

Yêu cầu: Docker Engine/Compose, Python 3.11+ và các cổng loopback 18080, 18082, 18333, 19080 trống. Chạy từ thư mục chứa README này:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python render.py
docker compose --env-file generated/.env -f compose.yaml config -q
docker compose --env-file generated/.env -f compose.yaml up -d --build
.venv\Scripts\python smoke.py
docker compose --env-file generated/.env -f compose.yaml down
```

`render.py` chạy một lần cho một bộ credential. `down` giữ volume thử để xem lại; chỉ dùng `down -v` nếu muốn xóa **riêng** dữ liệu spike. `smoke.py` tự đợi service sẵn sàng, thử cả nhánh đúng/sai và restart core/SeaweedFS/Flowable. Khi chạy lại cùng volume, BPMN đã deploy thì script dùng định nghĩa đang có; run đầu từ volume sạch phải thấy version 1. Cổng bind `127.0.0.1`; upstream, core và DB không publish ra host. `.dockerignore` chặn `generated/` và `.venv/` khỏi build context.

## Kết quả quan sát 17/11/2026 (Asia/Saigon)

Fresh Compose từ file trong thư mục này: `config -q` exit 0, `smoke.py` exit 0. Output đã loại credential:

```json
{"result":"PASS","gateway":{"pkce_valid":200,"pkce_wrong_verifier":400,"public_anonymous":200,"private_anonymous":401,"private_user":200,"private_sender_a":403,"private_sender_c":403,"federation_sender_a":202,"federation_sender_c":403,"federation_user":403,"unknown_route":404},"core":{"anonymous":401,"service_token":403,"invalid_payload":422,"created":201,"direct_anonymous":401,"restart":"record persisted","upstream_stopped":"core+identity+workflow alive"},"s3":{"unsigned":403,"presigned":200,"restart":"persisted","logical_restore_sha256":"6fd0bb7258ef62dd33a5d436ab00b730b91c1b58e648895002906c5acef5e4ba"},"flowable":{"anonymous":401,"default_admin":401,"version":1,"restart":"tasks persisted","ends":{"true":"approvedEnd","false":"rejectedEnd"}}}
```

Core spike: `POST /api/v1/core/records` 201, GET bản ghi sau restart 200, thiếu token 401, service token 403, payload sai 422, gọi trực tiếp container không token 401. Khi dừng `upstream` giả lập app, core+Keycloak+Flowable vẫn 200 và bản ghi còn; bật upstream lại vẫn 200. PostgreSQL của core là **DB scratch riêng**, không chứng minh role grants/schema chung app DB hay file/scan P03. Core tự verify chữ ký/issuer/expiry/`sub`/`azp`/scope; `aud` và membership/resource policy thật còn là gate P02/P03. Image core build local từ Python base digest cố định và `requirements-core.txt` pin phiên bản; snapshot core 27.68 MiB, core DB 58.99 MiB, không phải peak.

SeaweedFS: private S3 object PUT/GET, unsigned GET 403, presigned GET 200, volume còn object sau restart, logical backup/read → delete → restore có cùng SHA-256. Đây **chưa phải** thử phục hồi cả volume hoặc metadata app. Flowable: deploy BPMN v1, hai process có user task, task còn sau restart, approve tới `approvedEnd`, reject tới `rejectedEnd`, history truy được; admin mặc định `rest-admin:test` trả 401, credential thử riêng trả 200. Đây **chưa phải** app↔Flowable bridge/reconciler. APISIX `data_plane` đọc YAML, không cần etcd; token máy thiếu `erp:user` bị chặn private. Browser PKCE chạy với Keycloak trên HTTP loopback; script bỏ cờ Secure của cookie **chỉ trong trình duyệt giả thử nghiệm**. Bản triển khai phải dùng HTTPS, một issuer URL nhất quán cho browser/gateway và session an toàn.

Đã thử thêm: token phát với issuer `http://127.0.0.1:18080/...` bị APISIX từ chối 401 vì discovery trong Docker dùng `http://keycloak:8080/...`; Host header nội bộ trong smoke giúp kiểm cùng issuer. Đây là bằng chứng cần thiết kế hostname HTTPS chung ở P02, không phải cách cấu hình production.

Khi thêm core, phát hiện access token Keycloak 26.8.2 của realm import tối giản **không có `sub`** dù có `erp:user`; đã thêm `oidc-sub-mapper` vào scope và thử `sub` hiện diện. APISIX OIDC mặc định chuyển token lên `X-Access-Token`; core route đặt `access_token_in_authorization_header: true` để backend verify bearer từ `Authorization`. P02 phải cố định mapper/audience và kiểm cả issuer, scope, subject, client, bypass. [Keycloak upgrade guide về `sub`](https://www.keycloak.org/docs/26.7.3/upgrading/), [APISIX OIDC header](https://apisix.apache.org/docs/apisix/plugins/openid-connect/).

## Build từ source SeaweedFS

Tag [SeaweedFS 4.53](https://github.com/seaweedfs/seaweedfs/releases/tag/4.53) trỏ commit `4ab66fb`. Tarball `https://github.com/seaweedfs/seaweedfs/archive/refs/tags/4.53.tar.gz` có SHA-256 `d499b380cb22fb6c1dedd8e11ba62958ffe7f655dc4655f6993e578ccb8b0f4b0`. Build bằng `golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36` cho Linux amd64 tạo binary SHA-256 `41ae42900d747de851c166c80410919335683bf01a4bdfbf7a122d04e25a857f`; chạy binary trong container in `version 30GB 4.53 linux amd64`. File `LICENSE` của source tag là Apache-2.0. Build này xác nhận **có thể tạo binary từ source** trên máy thử; không chứng minh image Docker phát hành tái lập bit-for-bit hay license của mọi dependency Go.

Lệnh build lại trong thư mục scratch riêng (PowerShell); chạy **khi stack Compose đã dừng** để tránh tranh RAM. Tên thư mục do tarball tag 4.53 tạo ra đã được kiểm tra trong lần thử:

```powershell
$p00Scratch = Join-Path $env:TEMP 'nexora-p00-seaweed-build'
New-Item -ItemType Directory -Force -Path $p00Scratch | Out-Null
Invoke-WebRequest -Uri 'https://github.com/seaweedfs/seaweedfs/archive/refs/tags/4.53.tar.gz' -OutFile (Join-Path $p00Scratch 'seaweedfs-4.53.tar.gz')
Get-FileHash -Algorithm SHA256 (Join-Path $p00Scratch 'seaweedfs-4.53.tar.gz')
tar -xzf (Join-Path $p00Scratch 'seaweedfs-4.53.tar.gz') -C $p00Scratch
New-Item -ItemType Directory -Force -Path (Join-Path $p00Scratch 'build') | Out-Null
$p00Source = (Resolve-Path (Join-Path $p00Scratch 'seaweedfs-seaweedfs-4ab66fb')).Path.Replace([char]92,'/')
$p00Output = (Resolve-Path (Join-Path $p00Scratch 'build')).Path.Replace([char]92,'/')
docker run --rm --memory=6g --cpus=4 -e GOMAXPROCS=2 --mount "type=bind,source=$p00Source,target=/src,readonly" --mount "type=bind,source=$p00Output,target=/out" --mount type=volume,source=nexora-p00-go-mod-cache,target=/go/pkg/mod --mount type=volume,source=nexora-p00-go-build-cache,target=/root/.cache/go-build -w /src golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36 sh -c 'CGO_ENABLED=0 go build -p 2 -trimpath -o /out/weed-rebuild ./weed'
docker run --rm --mount "type=bind,source=$p00Output,target=/out,readonly" --entrypoint /out/weed-rebuild golang:1.26.6-bookworm version
```

Lần build lại cô lập ngày 17/11/2026 exit 0, `weed-rebuild` SHA-256 `fd39922d6add08c4ce019e6a34536fa92f452f67205a8289b4858947d3c6fa12` và in version 4.53. Hash khác binary build đầu vì cách build/path/flags không được cố định giống nhau; **không** tuyên bố reproducible bit-for-bit. Một lần build không giới hạn song song khi cả Compose stack đang chạy làm Docker Engine reset (`unexpected EOF`), toàn bộ container spike dừng; bản build cô lập giới hạn 6 GiB/4 CPU đã pass. P01/P12 phải đo tải đồng thời trước khi chốt máy demo.

## Nguồn và giới hạn

- [APISIX file mode](https://apisix.apache.org/docs/apisix/installation-guide/), [OIDC plugin](https://apisix.apache.org/docs/apisix/plugins/openid-connect/), [Keycloak realm import](https://www.keycloak.org/server/importExport), [Flowable REST](https://www.flowable.com/open-source/docs/bpmn/ch14-REST), [SeaweedFS source/license](https://github.com/seaweedfs/seaweedfs/tree/4.53).
- Image digest và RAM snapshot nằm ở ADR D01/D02/D04/D06/D13. Snapshot RAM sau khởi động không phải peak/full stack A/B/C.
- Chưa có Core Data/File API **sản phẩm**, app DB membership/partner mapping, app transaction, scanner, TLS, BFF/session, A/B/C federation hoặc source build của toàn bộ image. Các gate P01–P04/P05/P09 vẫn phải kiểm trên ứng dụng thực. Không dùng upstream giả, core scratch hoặc script này để đánh dấu AC/§3 đã đạt.
