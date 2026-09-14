/**
 * Nội dung hướng dẫn sử dụng tool.
 *
 * Để dạng DỮ LIỆU chứ không nhồi vào JSX: panel hướng dẫn còn phải lọc theo từ khoá và dựng mục
 * lục từ đây, mà làm hai việc đó trên một cây JSX viết tay thì mỗi lần thêm mục lại phải sửa ba chỗ.
 */

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'keys'; items: { k: string; d: string }[] }
  | { kind: 'note'; text: string };

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
}

export const GUIDE: GuideSection[] = [
  {
    id: 'batdau',
    title: 'Bắt đầu',
    blocks: [
      {
        kind: 'p',
        text: 'Tool này dựng level cho game puzzle bắn khối: bạn xếp khối màu trong không gian 3D, xếp các khẩu súng (blaster) vào hàng chờ, rồi xuất ra file LevelData (.asset) cho Unity đọc.',
      },
      {
        kind: 'steps',
        items: [
          'Dựng hình khối — xếp tay bằng chuột, hoặc tạo từ ảnh 2D / model 3D rồi sửa lại.',
          'Sơn màu — mỗi màu là một ColorType của game; ô tường là cơ chế riêng, không bắn được.',
          'Xếp súng — mở bảng 🔫 Blaster, tự tạo nhanh rồi chỉnh tay. Số đạn từng màu phải bằng đúng số khối màu đó.',
          'Kiểm — bấm “Thử giải” để chắc màn phá hết được khối, và xem điểm khó.',
          'Xuất — mở “Xuất .asset”, canh hướng khối trong khung xem trước, rồi tải file về.',
        ],
      },
      {
        kind: 'note',
        text: 'Tool tự lưu vào máy (localStorage) sau mỗi thay đổi, nên đóng tab mở lại vẫn còn level đang làm. Nhưng đó KHÔNG phải bản lưu chính thức — muốn giữ thì xuất ra file .asset.',
      },
      {
        kind: 'p',
        text: 'Trục đứng của scene là Z, trùng hệ trục của LevelData: toạ độ một khối trong editor bằng toạ độ trong file, chỉ trừ phép dời tâm khi xuất và phép lật chiều sâu (y đổi dấu). Phép lật đó là cần thiết vì Unity thuận trái còn scene của tool thuận phải — không lật thì mọi thứ có chiều (chữ viết, mặt người, logo) vào game bị lộn gương. Tool lo việc này ở đúng một chỗ khi ghi/đọc file, nên bạn dựng thấy sao thì game hiện vậy.',
      },
    ],
  },

  {
    id: 'dungkhoi',
    title: 'Dựng khối bằng chuột',
    blocks: [
      {
        kind: 'p',
        text: 'Bốn công cụ ở nhóm giữa toolbar, chọn một trong bốn: Đặt, Xóa, Sơn, Chọn.',
      },
      {
        kind: 'ul',
        items: [
          'Đặt — bấm mặt sàn hoặc mặt một khối để đặt khối áp vào mặt đó (kiểu Minecraft).',
          'Xóa — bấm khối để xoá.',
          'Sơn — bấm khối để đổi màu nó sang màu đang chọn, không thêm không bớt khối.',
          'Chọn — quét ra một vùng để dời / copy / nhân bản / xoá cả cụm (xem mục riêng bên dưới).',
        ],
      },
      {
        kind: 'p',
        text: 'Giữ chuột và kéo là làm cả một vùng chữ nhật cùng lúc, không phải từng ô. Đang kéo mà giữ thêm Ctrl thì di chuột lên/xuống để nâng/hạ CHIỀU CAO của vùng — một cú kéo dựng được cả khối hộp.',
      },
      {
        kind: 'keys',
        items: [
          { k: 'B / E / P / S / D', d: 'đổi công cụ: Đặt / Xóa / Sơn / Chọn vùng / Chọn 2D' },
          { k: 'giữ X', d: 'tạm chuyển sang xoá, thả ra là về công cụ cũ' },
          { k: 'giữ C', d: 'hút màu từ khối đang trỏ (eyedropper)' },
          { k: 'Ctrl (khi đang kéo)', d: 'nâng/hạ chiều cao vùng' },
          { k: 'Esc', d: 'huỷ cú kéo đang làm' },
          { k: 'Ctrl+Z / Ctrl+Y', d: 'hoàn tác / làm lại (một cú kéo cả vùng = một lần hoàn tác)' },
        ],
      },
      {
        kind: 'p',
        text: 'Hai nút ⇋X và ⇋Y bật đối xứng: đặt hoặc xoá một bên thì bên kia làm theo, lấy mặt x=0 và y=0 làm gương. Tiện cho khối cân đối, nhưng nhớ tắt khi muốn sửa lệch một bên.',
      },
      {
        kind: 'note',
        text: 'Viền mờ quanh mỗi cube là để phân biệt khối cạnh nhau; khung TRẮNG dày là ô sắp đặt, khung ĐỎ là sắp xoá, khung CAM gạch đứt là vùng chọn.',
      },
    ],
  },

  {
    id: 'chonvung',
    title: 'Chọn vùng (S) / Chọn 2D (D) — dời, copy, nhân bản',
    blocks: [
      {
        kind: 'p',
        text: 'Bấm ⬚ Chọn (hoặc phím S) rồi kéo ra một hộp — vẫn giữ Ctrl trong lúc kéo để đổi chiều cao như khi đặt khối. Hộp chọn hiện màu cam gạch đứt, kèm bảng thao tác bên phải màn hình.',
      },
      {
        kind: 'keys',
        items: [
          { k: '← → ↑ ↓', d: 'dời cả cụm khối theo trục X / Y một ô' },
          { k: 'PageUp / PageDown', d: 'dời cụm lên / xuống một tầng (trục Z)' },
          { k: 'Shift + mũi tên', d: 'chỉ dời KHUNG chọn, khối đứng yên — dùng để chọn lại chỗ khác' },
          { k: 'Ctrl+C / Ctrl+V', d: 'copy cụm / dán vào ô chuột đang trỏ' },
          { k: 'Ctrl+D', d: 'nhân bản cụm sang liền kề theo trục X' },
          { k: 'Delete', d: 'xoá khối trong vùng' },
          { k: 'Esc', d: 'bỏ chọn' },
        ],
      },
      {
        kind: 'p',
        text: 'Bảng thao tác xếp thành từng nhóm nút theo trục (nhãn màu đúng màu trục): Dời khối (dời cả cụm, khung đi theo), Dời khung (chỉ dời vùng chọn, khối đứng yên — bằng Shift + mũi tên), Cỡ khung (nới/co hộp chọn một ô: nút thường đụng phía dương, giữ Shift để đụng phía âm), Quay 90°, và Nhân bản. Mỗi thao tác dời/dán/xoá là một lần hoàn tác, không phải từng khối một.',
      },
      {
        kind: 'p',
        text: 'Hàng ↺↻ QUAY cụm đang chọn 90° quanh từng trục (↻ = theo chiều kim đồng hồ khi nhìn từ đầu dương của trục, ↺ = ngược lại). Chỉ 90°: quay một góc lẻ thì phải lấy mẫu lại lưới, hình ra rỗ lỗ và SỐ KHỐI đổi — mà số khối là điều kiện thắng của màn. Quay xong vùng chọn đi theo cụm nên quay tiếp / dời tiếp được ngay, và mỗi lần quay là một lần Ctrl+Z.',
      },
      {
        kind: 'note',
        text: 'Cụm quay tại chỗ (giữ tâm) khi hai cạnh của mặt phẳng bị quay cùng chẵn hoặc cùng lẻ — luôn đúng với cụm vuông. Khác nhau thì tâm mới lệch nửa ô nên tool neo góc nhỏ nhất của hộp bao, cụm sẽ xê dịch một chút; dùng mũi tên dời lại. Dù thế nào thì quay 4 lần cũng về đúng chỗ ban đầu, không trôi dần.',
      },
      {
        kind: 'p',
        text: '▭ Chọn 2D (phím D) là cách chọn thứ hai: kéo một khung chữ nhật NGAY TRÊN MÀN HÌNH, thả ra thì mọi khối có tâm nằm trong khung được chọn. Khoanh theo đúng hình đang thấy nên lấy được cái đầu, cái tay, một mảng chéo — thứ mà hộp 3D phải quét nhiều lần. Các khối được chọn tô sáng từng viên, kèm khung gạch đứt của hộp bao.',
      },
      {
        kind: 'ul',
        items: [
          'Chọn XUYÊN chiều sâu: khối bị khối khác che vẫn được chọn nếu tâm nó nằm trong khung. Muốn lấy riêng lớp vỏ thì tắt các layer trong đi rồi khoanh — khối đang ẩn không bao giờ bị chọn.',
          'Giữ Ctrl trong lúc kéo = CHỌN THÊM vào vùng đang có (khung đổi sang màu xanh gạch đứt). Không dùng Shift/Alt vì hai phím đó đang là pan / xoay camera.',
          'Bấm một cái không kéo = bỏ chọn.',
          'Chọn xong thì dùng chung mọi thao tác với hộp 3D: mũi tên dời, Ctrl+C/V, Ctrl+D, Delete, các nhóm nút bên phải. Copy chỉ lấy đúng các khối đã chọn, không lấy cả hộp bao. Riêng “Cỡ khung” đổi nghĩa cho hợp: + là THÊM một hàng khối kế tiếp vào vùng đang chọn, − là bỏ hàng ngoài cùng ra (vì chọn 2D là tập ô rời chứ không phải hộp).',
        ],
      },
      {
        kind: 'note',
        text: 'Dời cụm vào chỗ đã có khối thì khối cũ bị ghi đè. Đổi sang công cụ khác (không phải hai công cụ chọn) là tự bỏ vùng chọn (clipboard vẫn giữ).',
      },
    ],
  },

  {
    id: 'camera',
    title: 'Camera',
    blocks: [
      {
        kind: 'keys',
        items: [
          { k: 'chuột phải + kéo', d: 'xoay quanh khối' },
          { k: 'Space (hoặc Alt) + trái', d: 'xoay — dùng khi tay đang ở bàn phím' },
          { k: 'Shift + trái, hoặc chuột giữa', d: 'pan (dịch ngang)' },
          { k: 'lăn chuột', d: 'zoom' },
          { k: 'R', d: 'reset về góc nhìn ban đầu' },
          { k: 'F', d: 'đưa toàn bộ khối vào khung nhìn' },
        ],
      },
      {
        kind: 'p',
        text: 'Gizmo ba trục ở góc dưới phải: bấm vào một mặt để nhìn theo trục đó. Trục X đỏ, Y xanh lá, Z xanh dương — hai đường trục chính trên lưới sàn cũng tô cùng màu (bản sậm hơn) để dễ xác định hướng.',
      },
      {
        kind: 'p',
        text: 'HUD góc trên phải hiện toạ độ khối đang trỏ, depth của nó và tên ColorType. Khi bật “dời khối về giữa gốc toạ độ” thì có thêm một dòng toạ độ trong file .asset — đó mới là con số Unity đọc.',
      },
    ],
  },

  {
    id: 'mausac',
    title: 'Bảng màu và ô tường',
    blocks: [
      {
        kind: 'p',
        text: 'Dãy ô màu trên toolbar là 16 ColorType của game cộng ô tường. Bảng này CỐ ĐỊNH, không thêm/sửa/xoá được: mỗi ô ứng với đúng một giá trị enum bên Unity, đổi hex là phá luôn ánh xạ đó. Muốn đổi màu thì đổi bên Unity rồi cập nhật lại trong core.',
      },
      {
        kind: 'p',
        text: 'Nút ⚙ cạnh dãy ô mở bảng ColorType đầy đủ: số id, tên, mã hex của từng màu.',
      },
      {
        kind: 'p',
        text: 'Ô 🧱 Tường nằm CUỐI dãy (dù id của nó là 0) vì nó không phải một màu để tô mà là một cơ chế: khối tường không bao giờ bị phá, không súng nào bắn được, không tính vào điều kiện thắng. Dùng nó để bịt hướng bắn, buộc người chơi xoay khối tìm góc khác. Nút 🧱 Tường ở nhóm Mechanic cũng chỉ là lối vào có tên cho ô màu đó.',
      },
      {
        kind: 'p',
        text: 'Bảng màu bên phải màn hình (ColorLegend) liệt kê các màu đang dùng kèm số khối mỗi màu; bấm một màu để CHỈ hiện khối màu đó (chọn được nhiều màu) — tiện khi cần soi bên trong khối.',
      },
      {
        kind: 'note',
        text: 'Nếu dùng màu ngoài bảng (ví dụ nhập từ ảnh), lúc xuất tool phải dò màu gần nhất và sẽ cảnh báo. Sơn lại bằng đúng bảng màu để khỏi bị đoán.',
      },
    ],
  },

  {
    id: 'layer',
    title: 'Tầng và tô màu theo tầng',
    blocks: [
      {
        kind: 'p',
        text: 'Mỗi dòng depth có nút 🗑 ở cuối: xoá sạch mọi khối ở depth đó (hỏi lại trước khi xoá, và Ctrl+Z hoàn tác trong một bước). Danh sách layer bên trái cho ẩn/hiện từng layer (theo depth + màu), hoặc solo một layer — khối bị ẩn cũng không bị chuột chạm tới, nên sửa bên trong khối dễ hơn nhiều.',
      },
      {
        kind: 'note',
        text: 'Khối đang bị ẩn thì SƠN, XOÁ và các thao tác vùng chọn (dời / copy / xoá) đều bỏ qua nó — chỉ khối đang hiện mới bị chạm tới, kể cả khối sinh ra do đối xứng ⇋X/⇋Y. Muốn sửa khối bị ẩn thì bật layer đó lên trước. Bảng 🎨 Tô tầng cũng vậy, và có sẵn cả hai bộ lọc ngay trong bảng: danh sách layer ở cột bên trái, bảng màu ở cột bên phải (dùng chung bộ lọc với scene chính — tắt ở đây thì ngoài kia cũng tắt). Khối bị ẩn thì biến khỏi khung xem 3D và không ăn nét tô; trong lưới 2D nó thành ô XÁM GẠCH CHÉO, để phân biệt với ô trống thật (ô trống mới thêm khối được). Lớp đang xem không tự nhảy khi bạn ẩn/hiện: dù lớp đó trống trơn sau khi ẩn thì vẫn ở đúng lớp đấy.',
      },
      {
        kind: 'p',
        text: 'Nút 🎨 Tô tầng mở bảng riêng: mỗi lớp hiện thành một lưới 2D để tô màu từng ô cho nhanh, kèm khung xem 3D bên cạnh. Chuyển tầng bằng hai nút ◀ ▶, hoặc gõ thẳng số vào ô “4 / 7” (tầng thứ 4 trên 7 tầng — đếm theo thứ tự, không phải toạ độ) rồi Enter để nhảy tới tầng đó. Hai công cụ: ➕ Thêm (ô trống thì tạo khối màu đang chọn, ô đã có khối thì đổi sang màu đó) và 🧹 Xóa. Chọn HƯỚNG CẮT ở thanh trên: Tầng Z cắt ngang (trên→dưới, lưới là mặt XY), Cột X cắt dọc (trái→phải, lưới là mặt YZ), Lớp Y cắt dọc (trước→sau, lưới là mặt XZ). Cắt dọc là cách tô chi tiết đứng — mặt, chữ — mà cắt ngang phải nhảy tầng liên tục mới vẽ nổi. Mỗi hướng nhớ riêng lớp đang xem.',
      },
      {
        kind: 'p',
        text: 'Copy / dán cả TẦNG (nhóm “Tầng” trong bảng Tô tầng): ⧉ Copy chụp toàn bộ tầng đang xem (Ctrl+C), chuyển sang tầng khác rồi 📥 Dán (Ctrl+V) là tầng đó thành y hệt — sơn ô có màu, thêm ô còn trống, xoá ô dư. Cả cụm gộp đúng MỘT lần Ctrl+Z.',
      },
      {
        kind: 'ul',
        items: [
          'Chỉ copy khối ĐANG HIỆN, và dán không bao giờ chạm khối đang bị ẩn — giống mọi thao tác khác trong bảng.',
          'Khi đang giữ một tầng đã copy, hai nút ◀ ▶ đi được thêm 1 lớp trống ra ngoài khối mỗi phía: chỗ để dán thành TẦNG MỚI (nhân đôi sàn lên trên, kéo dài khối thêm một lớp). Lúc đó ô số hiện 0 hoặc N+1 kèm chữ “lớp mới”.',
          'Dán được trong cùng một hướng cắt thôi: copy ở Tầng Z rồi đổi sang Cột X thì lưới là mặt phẳng khác, phải copy lại.',
        ],
      },
      {
        kind: 'p',
        text: 'Khái niệm depth: số lớp phải bóc từ vỏ vào tới khối đó (láng giềng 6 mặt). Game dùng depth để mở khoá khối dần. Tool tính tự động, nhưng ở bảng Xuất bạn ép được depth của từng layer nếu muốn một lớp mở muộn hơn.',
      },
    ],
  },

  {
    id: 'chianho',
    title: 'Chia nhỏ khối (tăng số khối, giữ nguyên hình)',
    blocks: [
      {
        kind: 'p',
        text: 'Nút ⧉ Chia nhỏ: nhập số phần mỗi cạnh n, mỗi khối thành n×n×n khối con cùng màu. Hình không xê dịch một ô nào, chỉ mịn hơn — dùng khi cần màn nhiều khối hơn (nhiều đạn, phá lâu hơn) mà không phải vẽ lại. n=2 là ×8 khối, n=3 là ×27, n=4 là ×64.',
      },
      {
        kind: 'ul',
        items: [
          'Số đạn của mọi súng được nhân ×n³ (tắt được): số khối từng màu vừa ×n³, mà tổng đạn phải bằng đúng số khối màu đó thì màn mới phá hết được.',
          'objectScale được chia cho n (tắt được): khối giờ dài gấp n lần theo mỗi cạnh, không thu nhỏ lại thì trong game nó phình gấp n lần. Tâm khối cũng nhân theo để chỗ đứng lúc xuất không đổi.',
          'depth ép tay ở bảng Xuất bị xoá: vỏ ngoài giờ dày n lớp nên khoá depth cũ không còn trỏ đúng layer nào.',
        ],
      },
      {
        kind: 'note',
        text: 'Ctrl+Z hoàn tác cả cụm trên trong một lần. Số khối tăng rất nhanh (91 khối với n=3 là 2457 khối) — bảng hiện sẵn số khối sau khi chia trước khi bấm, và cảnh báo khi vượt 30.000 khối vì lúc đó xoay/sửa bắt đầu giật.',
      },
    ],
  },

  {
    id: 'nhaphinh',
    title: 'Tạo khối từ ảnh 2D / model 3D',
    blocks: [
      {
        kind: 'p',
        text: 'Nút 🖼 Ảnh: chọn ảnh pixel-art, tool tự dò lưới và bỏ nền. Trong bảng nhập bạn vẽ/xoá từng ô, chọn màu theo ảnh hay theo bảng màu game.',
      },
      {
        kind: 'p',
        text: 'Cỡ ngòi (ô “Ngòi” ở nhóm Chỉnh, dùng chung cho cả Vẽ lẫn Xoá): kéo thanh hoặc gõ số 1–32, mỗi nét ăn cả ô vuông n×n thay vì từng ô — ngòi 2 là chạm một cái được 4 ô, ngòi 3 được 9 ô. Khung trắng (đỏ khi đang Xoá) trên lưới cho thấy trước vùng ngòi sẽ ăn vào. Kéo nhanh vẫn ra nét liền vì tool nối các điểm chuột lại chứ không chấm rời từng điểm.',
      },
      {
        kind: 'note',
        text: 'Nhóm Mechanic trong bảng nhập ảnh có nút 🧱 Tường: bấm rồi vẽ như một màu thường (ô tường hiện thành viên gạch trên lưới). Phép dò màu từ ảnh KHÔNG bao giờ tự sinh ra tường — trước đây nó xét cả ô tường nên pixel xám xám trong ảnh lặng lẽ thành khối không bắn được. Tường giờ chỉ có khi bạn tô tay, và thanh trên hiện luôn số ô tường đang có.',
      },
      {
        kind: 'ul',
        items: [
          'Độ dày + dáng khối: đùn theo trục Z với dáng Hộp / Kim tự tháp / Vòm / Bầu dục.',
          'Định hình tầng: mỗi hàng ảnh dựng thành mặt cắt Tròn / Vuông, biến ảnh phẳng thành khối tròn xoay.',
          'Đổ màu: Theo ảnh (tô theo cột) hoặc Bọc 4 mặt (nhìn từ 4 hướng chính đều thấy ảnh gốc).',
        ],
      },
      {
        kind: 'p',
        text: 'Nút 🧊 Model: nạp .fbx .glb .gltf .obj .stl, voxel hoá đặc bằng ray-casting theo cột, xem trước 3D ngay trong bảng và voxel hoá lại theo thời gian thực khi đổi độ phân giải / màu / texture.',
      },
      {
        kind: 'p',
        text: 'Nút 🎯 Màu theo mặt (bật sẵn) quyết định mỗi khối lấy màu texture ở đâu. Bật: tool rải mẫu khắp bề mặt model — dày tới cỡ 1 mẫu / 1 pixel texture — rồi mỗi khối lấy màu THẮNG PHIẾU trên phần diện tích của nó. Tắt: về cách cũ, mỗi khối lấy đúng 1 pixel tại chỗ tia dò cắt mặt.',
      },
      {
        kind: 'ul',
        items: [
          'Vì sao cần: 1 pixel không đại diện cho cả khối. Để độ phân giải thấp thì một khối trải trên hàng chục pixel texture, bốc đúng pixel ở tâm ô là một đường viền / đường kẻ / pixel nhiễu cũng thành màu của cả khối — đó là lý do phải phóng ảnh thật to mới ra màu đúng.',
          'Mặt ĐỨNG (sườn khối) cũng hết sai màu: tia dò chạy dọc trục Y nên cắt sườn rất chéo, màu lấy được là màu ở chỗ tia cắt, cách xa chỗ khối thật sự nằm. Rải mẫu trên mặt thì mỗi khối nhận màu ở đúng chỗ của nó.',
          'Khối trong lòng (không mặt nào chạm) lấy màu loang từ khối vỏ gần nhất, nên lớp trong lộ ra vẫn cùng màu với vùng vỏ ngay ngoài nó.',
        ],
      },
      {
        kind: 'p',
        text: 'Nhóm “Bảng màu game” trong bảng nhập model quyết định màu nguồn (texture / vật liệu) được quy về 16 ColorType thế nào — level cuối cùng chỉ có 16 màu đó, nên bước này luôn xảy ra, khác nhau chỉ ở chỗ nó xảy ra lúc nào và có gộp màu hay không:',
      },
      {
        kind: 'ul',
        items: [
          '🎯 Tách màu (mặc định) — mỗi màu nguồn chiếm một màu game RIÊNG. Hai màu A, B cùng gần màu game C thì màu bám sát C hơn được lấy C, màu còn lại nhận màu TRỐNG gần nó nhất, thay vì cả hai nhập thành C và hình mất chi tiết.',
          'Gần nhất — kiểu cũ: mỗi màu nguồn tự dò màu gần nhất, chấp nhận nhiều màu về cùng một màu.',
          'Màu gốc — giữ nguyên hex của model. Khối vào tool đúng màu gốc, nhưng lúc xuất .asset vẫn bị dò về màu gần nhất (và vẫn có thể gộp).',
          'tối đa N — số màu game được dùng, nhiều màu nguồn hơn thì gom cụm lại chứ không cắt bớt. Hạ số này để làm màn ít màu cho dễ.',
          'gộp dưới ΔE — hai màu nguồn cách nhau dưới mức này coi là một màu. Cần có: texture nén hay có mấy hex lệch 1–2 độ mắt không phân biệt được, tách chúng ra là hình rằn ri hơn cả lúc bị gộp.',
        ],
      },
      {
        kind: 'p',
        text: 'Bảng “Gán màu” bên phải khung xem trước liệt kê từng nhóm: ô màu nguồn → ô màu game, kèm số khối. Dấu ⇄ nghĩa là nhóm đó phải nhường màu gần nhất cho nhóm khác — chỗ đáng xem trước tiên khi màu ra không như ý. Ô chọn ở mỗi dòng cho ép nhóm về màu game khác; màu đang bị nhóm khác giữ thì hai nhóm tự đổi chỗ, không bao giờ để hai nhóm dùng chung một màu.',
      },
      {
        kind: 'note',
        text: 'Model phải KÍN MẶT mới lấp trong đúng. Model dựng theo Z-up có thể bị nằm ngang — xoay ở phần mềm nguồn trước khi nạp.',
      },
    ],
  },

  {
    id: 'lopboc',
    title: 'Lớp bọc 🧊 Băng / 🛡 Shield — bọc một hộp khối lại',
    blocks: [
      {
        kind: 'p',
        text: 'Lớp bọc là một cái vỏ HÌNH HỘP trùm lên một cụm khối: phải phá vỏ (đủ hp lần) mới bắn được khối bên trong. Cách dựng: kéo hộp bằng công cụ ⬚ Chọn (hoặc ▭ Chọn 2D rồi lấy hộp bao), sau đó bấm 🧊 Băng hoặc 🛡 Shield ở nhóm “Bọc cụm đang chọn” trong bảng vùng chọn. Hộp vùng chọn chính là hộp của lớp bọc, nên không có công cụ kéo riêng nào để học. Hai loại dùng chung một khuôn data (bounds + hp + hpTexts + innerVoxelPositions), chỉ khác chỗ ghi trong file: iceWrapperData và shieldData — nên bấm nhầm loại thì đổi tại chỗ bằng icon ở đầu dòng trong danh sách.',
      },
      {
        kind: 'p',
        text: 'Danh sách 🧊 ở góc dưới-trái liệt kê mọi lớp bọc: cỡ hộp, số khối bên trong, ô nhập hp, nút ⬚ chọn lại hộp đó và 🗑 bỏ lớp bọc (không xoá khối). Trỏ chuột vào một dòng là lớp bọc đó SÁNG TRẮNG trong scene kèm tô sáng từng khối nó bọc (các lớp khác mờ đi); bấm vào dòng để giữ sáng cố định, bấm lại để thôi. Nút ✕ ở góc bảng ẩn hẳn bảng đi; bật lại bằng nút 🧊 trên toolbar (nút đó cũng hiện số lớp bọc, và xám khi level chưa có lớp nào). Trong scene mỗi lớp bọc là một khung xanh băng, vẽ xuyên khối để không bị cụm che mất.',
      },
      {
        kind: 'ul',
        items: [
          'Bạn chỉ nhập HỘP và HP. Còn lại tool tự tính lúc xuất: bounds (tâm + extent = NỬA cỡ, tính cả nửa ô ở hai đầu), innerVoxelPositions (mọi khối trong hộp, tự cập nhật khi bạn vẽ thêm/xoá khối bên trong), hpTexts (dán số HP lên các mặt đang HỞ — mặt bị khối khác che thì không dán).',
          'Sửa hộp: kéo vùng chọn mới rồi bấm lại, xoá lớp cũ bằng 🗑. Khung trong scene đổi màu theo loại (băng xanh, shield tím); lớp đang soi thì sáng trắng.',
          'Chia nhỏ khối (⧉) cũng nhân hộp bọc theo, nên lớp bọc vẫn trùm đúng cụm cũ.',
          'Xuất/nhập giữ nguyên lớp bọc cả hai loại — nhập lại file vừa xuất là ra đúng level cũ (trước đây tool báo “iceWrapperData / shieldData sẽ mất nếu xuất đè”, giờ không còn).',
        ],
      },
      {
        kind: 'p',
        text: 'Bảng Xuất soát sẵn các lỗi không nhìn thấy bằng mắt: hộp không bọc khối nào, hp ≤ 0, hộp chỉ bọc tường, hộp có ô trống bên trong (vỏ là khối hộp nên trong game sẽ hở), bị che kín cả 6 mặt (không dán được số HP), và hai lớp bọc CHỒNG NHAU (một voxel không thể thuộc hai lớp bọc).',
      },
      {
        kind: 'note',
        text: 'Nút “Thử giải” CHƯA biết luật lớp bọc — nó coi như khối bên trong bắn được ngay, nên màn thật khó hơn điểm nó chấm (kết quả có ghi lại lưu ý này khi level có lớp bọc). Và nhớ: LevelData.cs chỉ ghi iceWrapperData là “V1-relevant”, còn shieldData nằm trong nhóm “extensibility placeholders” — tool xuất shield đúng chuẩn nhưng gameplay V1 chưa đọc, nên trong game chưa thấy tác dụng (bảng Xuất cũng nhắc lại khi level có shield).',
      },
    ],
  },

  {
    id: 'blaster',
    title: 'Bảng Blaster: xếp súng',
    blocks: [
      {
        kind: 'p',
        text: 'Bảng chia hai khung cạnh nhau, mỗi khung tự cuộn: BÊN TRÁI là lưới hàng chờ (mỗi hàng một cột dọc, ô trên cùng là đầu hàng — đúng như lúc chơi), BÊN PHẢI là cân đối đạn, thử giải, thanh mechanic, tạo nhanh và ô sửa khẩu đang chọn. Bấm một chip súng ở khung trái để chọn, rồi sửa ở khung phải: id, màu, số đạn, iceHp, isHidden, loại súng.',
      },
      {
        kind: 'note',
        text: 'Các ô chọn màu của súng (màu 1 và màu 2 của Double) chỉ hiện những màu ĐANG CÓ khối trên hình, không hiện cả 16 màu của game: chọn một màu không có khối nào là ra khẩu súng bắn vào hư không, tổng đạn lệch mà nhìn dãy ô màu không thấy gì sai. Màu mà khẩu đang mang nhưng hình không còn khối màu đó (level nhập vào, hoặc vừa xoá hết khối màu ấy) vẫn hiện, dạng ô mờ viền đứt.',
      },
      {
        kind: 'p',
        text: 'Phép kiểm quan trọng nhất là bảng “Đạn so với khối”: tổng số đạn của từng màu phải bằng ĐÚNG số khối cùng màu, vì điều kiện thắng là bắn hết khối. Thiếu đạn thì không phá xong màn, thừa đạn thì thừa vô ích. Màu nào lệch bị tô đỏ.',
      },
      {
        kind: 'p',
        text: 'Thanh mechanic ở trên là các chế độ bấm: bật một cơ chế rồi bấm vào chip súng để gán cơ chế đó (bấm lại là bỏ).',
      },
      {
        kind: 'ul',
        items: [
          '🔗 Connected — bấm 2 khẩu để nối. Cả cụm lên khoang cùng một lượt và chỉ biến mất khi MỌI khẩu trong cụm bắn xong.',
          '🧊 Ice — bọc băng: khẩu đó không bấm lên được; mỗi lượt nhấc một khẩu bất kỳ thì băng của mọi khẩu tan 1.',
          '🔒 Lock — ổ khoá: chưa mở thì không bấm được, và mọi khẩu xếp SAU nó trong hàng cũng kẹt theo.',
          '🔑 Key — chìa: hễ được nhấc lên khoang là mở một ổ khoá. Nhớ xếp chìa ở hàng KHÔNG bị chính ổ đó chặn.',
          '🎨 Double — súng hai màu: mỗi màu một túi đạn riêng bằng bulletCount, phải bắn hết màu 1 mới sang màu 2.',
          '❓ Hidden — giấu màu: chỉ lộ màu thật khi khẩu ngay trước nó được nhấc lên. Đừng giấu khẩu đang đứng đầu hàng.',
        ],
      },
      {
        kind: 'p',
        text: 'Nút “Thử giải” chạy mô phỏng: nó tự chơi hộ màn để chứng minh có phá hết khối được hay không, và chấm điểm khó 0–10 kèm giải thích từng yếu tố. Không giải được thì nó nói rõ mắc ở đâu.',
      },
      {
        kind: 'note',
        text: 'Điểm khó 10 nghĩa là “không giải được”, không phải “rất khó”. Dải làm việc thật là 1–6; muốn cao hơn thì phải sửa hình khối (thêm màu, thêm tường che, chôn màu sâu hơn) chứ không chỉ nhồi cơ chế.',
      },
    ],
  },

  {
    id: 'khoangcho',
    title: 'Luật khoang chờ (phải nắm để dựng đúng)',
    blocks: [
      {
        kind: 'p',
        text: 'Đây là phần dễ hiểu sai nhất, mà hiểu sai thì dựng ra màn không chơi được:',
      },
      {
        kind: 'ul',
        items: [
          'Khoang chờ có TỐI ĐA 5 ô. Ô nhập dockCount bị kẹp ở 5; file nhập vào ghi nhiều hơn cũng bị kẹp kèm cảnh báo.',
          'Mỗi hàng chỉ với tới được khẩu ĐẦU hàng.',
          'THUA = 5 khẩu đã lên khoang mà không khẩu nào còn khối hở cùng màu để bắn, hoặc không rút nổi nhóm nào nữa.',
          'Súng hết việc thì biến mất, chừa lại ô trống — nhưng tính theo ĐƠN VỊ rút, không theo từng khẩu.',
          'Súng lẻ: cạn đạn là đi ngay. Súng hai màu: phải cạn CẢ HAI túi. Cụm nối nhau: phải MỌI khẩu cạn đạn thì cả cụm mới cùng biến mất — khẩu hết đạn trước vẫn tiếp tục chiếm ô.',
          'Nhấc cụm nối nhau là nhấc cả cụm một lượt: phải còn đủ ô cho cả cụm. Cụm 3 khẩu mà khoang còn 2 ô thì không nhấc được; cụm đông hơn 5 khẩu thì không bao giờ nhấc được và tool chặn thẳng.',
        ],
      },
      {
        kind: 'note',
        text: 'Vì cụm nối nhau giữ ô cho tới khi cả cụm bắn xong, nối nhiều khẩu là rất đắt: nó bóp chết khoang chờ. Dùng có chủ đích thôi.',
      },
    ],
  },

  {
    id: 'taonhanh',
    title: 'Tạo súng tự động theo màu khối',
    blocks: [
      {
        kind: 'p',
        text: 'Nút ⚡ Tạo theo màu khối… trong bảng Blaster mở popup. Số đạn LUÔN được chia khớp đúng số khối từng màu — đó là điều kiện thắng, không phải tuỳ chọn.',
      },
      {
        kind: 'ul',
        items: [
          'Độ khó mục tiêu 1–10: kéo thanh là bật sẵn bộ cơ chế của mức đó và đặt khoảng random số lượng. Đây đúng thang điểm mà nút “Thử giải” chấm.',
          'Cơ chế: bật/tắt từng cái, mỗi cái có ô số. Để TRỐNG = tool tự random trong khoảng của mức điểm (ô số hiện sẵn khoảng đó); GÕ SỐ = đúng số đó, ví dụ Ice = 2 thì đúng 2 khẩu băng.',
          'Hàng chờ và Đạn/súng: số hàng và số đạn mong muốn mỗi khẩu (số thực tế chia lại cho khớp số khối).',
          'Checkbox đặt luôn difficulty của level: suy từ điểm bằng đúng ngưỡng mà tool dùng để chấm.',
        ],
      },
      {
        kind: 'p',
        text: 'Cách nó làm: sinh nhiều phương án (bớt / giữ / nhồi thêm cơ chế × 3 cách xếp màu vào hàng), tự chấm từng phương án bằng mô phỏng rồi giữ cái gần mức bạn đặt nhất, LOẠI THẲNG phương án không giải được. Nhờ vậy tường, số màu, số lớp phải bóc đều được tính vào.',
      },
      {
        kind: 'p',
        text: 'Cách xếp màu trong hàng là đòn bẩy mạnh nhất, vì khoang chờ chỉ có 5 ô: rải màu đều (dễ nhất), mỗi hàng dồn một màu, hay đầu mọi hàng cùng màu (dễ tắc nhất). Trên hình khối phân tầng theo màu, xếp sai kiểu là ra màn KHÔNG giải được — nên vòng dò bằng mô phỏng mới chọn đúng được.',
      },
      {
        kind: 'p',
        text: 'Sau khi tạo, bảng Blaster hiện một dòng tóm tắt: điểm thật đạt được, các cơ chế đã dựng, và cảnh báo vàng nếu dựng thiếu (bàn không đủ khẩu hợp lệ) hoặc nếu thang bị kẹt (bớt hết vẫn cao hơn / nhồi hết vẫn thấp hơn mức đặt).',
      },
    ],
  },

  {
    id: 'xuat',
    title: 'Xuất file .asset cho Unity',
    blocks: [
      {
        kind: 'p',
        text: 'Nút “Xuất .asset” mở bảng đầy đủ các trường của LevelData. Cột phải là khung xem trước hướng khối.',
      },
      {
        kind: 'ul',
        items: [
          'Tên, levelVersion, dockCount (tối đa 5), difficulty, shouldLoop, shouldOfferMeteorShower.',
          'rootPosition / rootLocalEulerAngles / objectCenterPosition / objectShadowPosition / objectScale — cách khối được đặt trong scene game.',
          'Dời khối về giữa gốc toạ độ: bật thì toạ độ xuất ra được dời cho khối nằm quanh gốc, đúng nếp của mọi level mẫu.',
          'Danh sách layer: sửa số depth để ép một layer mở khoá muộn hơn.',
        ],
      },
      {
        kind: 'p',
        text: 'Khung xem trước: CAMERA ĐỨNG YÊN, KHỐI QUAY — đúng như trong game, nơi chỉ transform gốc của level mang rootLocalEulerAngles. Kéo chuột trong khung là sửa thẳng ba góc đó: ngang = xoay quanh trục đứng của khối, dọc = ngả trước/sau, Shift + ngang = góc Y.',
      },
      {
        kind: 'ul',
        items: [
          '(90, 0, 0) — khối dựng thẳng, nhìn chính diện. Đây là góc mặc định của tool.',
          '(65, 0, 45) — dựng đứng, ngả ra xa 25°, xoay chéo 45°. Góc mà các level mẫu trong DataExample dùng.',
          '(0, 0, 0) — khối nằm ngửa, trục đứng chỉ vào màn hình.',
        ],
      },
      {
        kind: 'note',
        text: 'Khung này lùi xa hơn camera game và dùng ống kính hẹp hơn, để thấy trọn khối và thấy đúng hình dáng; cỡ hình không đổi khi xoay nên so được góc nào đẹp hơn. rootPosition và objectScale không áp vào khung: chúng chỉ dịch/phóng khối trong scene game chứ không đổi hướng. Với góc mặc định (90, 0, 0), khung hiện đúng thứ bạn thấy trong scene dựng — chữ viết đọc xuôi ở đây thì vào game cũng xuôi. Xoay khối 180° thì tất nhiên bạn đang xem mặt sau nên chữ đọc ngược, đó là hướng khối chứ không phải lỗi.',
      },
      {
        kind: 'p',
        text: 'Trước khi cho tải file, bảng này cảnh báo: level chưa có súng, phần súng còn chỗ chưa ổn (liệt kê từng lỗi), và màu nào phải dò gần nhất vì không có trong bảng màu game.',
      },
    ],
  },

  {
    id: 'nhap',
    title: 'Nhập file .asset có sẵn',
    blocks: [
      {
        kind: 'p',
        text: 'Nút “Nhập .asset” đọc file LevelData của Unity vào tool: khối, layer/depth, meta và cả phần súng. Nó THAY toàn bộ level đang mở nên tool sẽ hỏi lại trước khi làm.',
      },
      {
        kind: 'p',
        text: 'File Unity đặt khối quanh gốc (có z âm), còn editor coi z=0 là mặt sàn — nên khi nhập, tool nâng cả khối lên cho khối thấp nhất chạm sàn và ghi đúng lượng đã nâng vào tâm, để lúc xuất ra lại đúng toạ độ file gốc.',
      },
      {
        kind: 'note',
        text: 'Nhập xong nhớ đọc phần cảnh báo: nó nói những chỗ tool phải sửa hoặc đoán, ví dụ dockCount lớn hơn 5 bị kẹp lại.',
      },
    ],
  },

  {
    id: 'suco',
    title: 'Gặp vấn đề thì xem đây',
    blocks: [
      {
        kind: 'ul',
        items: [
          'Màu bị tô đỏ ở bảng đạn-vs-khối: thiếu hoặc thừa đạn màu đó. Thêm/bớt súng, hoặc bấm ⚡ tạo lại cả bộ cho khớp.',
          'Thử giải báo “tắc hàng”: 5 ô khoang bị chiếm mà không khẩu nào bắn được. Đổi thứ tự súng trong hàng, bớt cụm nối nhau, hoặc rải màu đều hơn.',
          'Thử giải báo cụm nối nhau kẹt: cụm đông hơn khoang, hoặc hai khẩu cùng hàng mà có khẩu khác chen giữa. Bỏ nối bớt, hoặc xếp hai khẩu sát nhau / khác hàng.',
          'Băng không bao giờ tan: iceHp dày hơn số lượt bấm còn lại, hoặc đầu MỌI hàng đều bọc băng. Chừa ít nhất một hàng có khẩu đầu không băng.',
          'Ổ khoá không mở được: số ổ nhiều hơn số chìa, hoặc chìa nằm sau chính ổ chặn nó.',
          'Xuất ra cảnh báo “màu phải dò gần nhất”: có khối dùng màu ngoài bảng ColorType. Sơn lại bằng dãy ô màu trên toolbar.',
          'Mất level đang làm: tool tự lưu vào localStorage của trình duyệt/app, nhưng xoá dữ liệu trình duyệt là mất. Xuất .asset để giữ chắc.',
        ],
      },
    ],
  },

  {
    id: 'phimtat',
    title: 'Tổng hợp phím tắt',
    blocks: [
      {
        kind: 'keys',
        items: [
          { k: 'B / E / P / S / D', d: 'công cụ Đặt / Xóa / Sơn / Chọn vùng / Chọn 2D' },
          { k: 'giữ X', d: 'tạm xoá' },
          { k: 'giữ C', d: 'hút màu' },
          { k: 'Ctrl (đang kéo)', d: 'nâng/hạ chiều cao vùng' },
          { k: 'Esc', d: 'huỷ cú kéo / bỏ vùng chọn' },
          { k: 'Ctrl+Z / Ctrl+Y', d: 'hoàn tác / làm lại' },
          { k: '← → ↑ ↓', d: 'dời cụm đã chọn theo X / Y' },
          { k: 'PageUp / PageDown', d: 'dời cụm đã chọn theo Z' },
          { k: 'Shift + mũi tên', d: 'chỉ dời khung chọn' },
          { k: 'Ctrl+C / Ctrl+V / Ctrl+D', d: 'copy / dán / nhân bản cụm' },
          { k: 'Delete', d: 'xoá khối trong vùng chọn' },
          { k: 'chuột phải kéo', d: 'xoay camera' },
          { k: 'Space (Alt) + trái', d: 'xoay camera' },
          { k: 'Shift + trái, chuột giữa', d: 'pan' },
          { k: 'lăn chuột', d: 'zoom' },
          { k: 'R / F', d: 'reset góc nhìn / thấy toàn bộ khối' },
          { k: 'F1 (hoặc ?)', d: 'mở bảng hướng dẫn này' },
        ],
      },
    ],
  },
];
