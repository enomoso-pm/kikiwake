# .dmg の中身と窓の見た目（dmgbuild の設定。scripts/make_dmg.sh が使う）。
#   dmgbuild -s scripts/dmg/dmgbuild_settings.py -D app=<Kikiwake.app> -D dir=<scripts/dmg> "Kikiwake <版>" <出力>.dmg
# 窓の背景は background.png（1920×1200。左上の 800×580 に絵、残りは同じ色）と background@2x.png（dmgbuild が 1 つの TIFF にまとめる）。元は background.html。
# アイコンの位置（中心）は background.html の絵と合わせる。.app は ditto で写すので署名は壊れない（make_dmg.sh が確かめる）
import os.path
import unicodedata

app = defines["app"]  # noqa: F821（dmgbuild が渡す）
here = defines["dir"]  # noqa: F821


def on_disk(name):
    # .dmg（HFS+）の上の名前は、濁点・半濁点を分けた形（NFD）になる。位置の記録の名前もそれに合わせないと、
    # Finder が同じ名前と見なさず、「アプリケーション」「はじめに読む.txt」の位置が効かない（2026-09-28 に実物で確かめた）
    return unicodedata.normalize("NFD", name)


format = "UDZO"
filesystem = "HFS+"
files = [app, os.path.join(here, "はじめに読む.txt"), os.path.join(here, "Read Me First.txt")]
# 「設定を開く」は、システム設定の「プライバシーとセキュリティ」の昔の部品への近道。開くと「セキュリティ」の欄が出る（macOS 26 で確かめた）。
# 住所（x-apple.systempreferences:）を書いた .webloc は、macOS 26 が開かない（-10400。落とした印の有無にかかわらず）ので使わない
symlinks = {"アプリケーション": "/Applications", "設定を開く": "/System/Library/PreferencePanes/Security.prefPane"}

background = os.path.join(here, "background.png")
# 大きさはタイトルバーを含めた窓全体（Finder はそう読む）。中身は macOS 26 で約 585、macOS 14・15 で約 590。
# どちらでも大事なもの（アイコンの名前の 578 まで）が欠けない。窓を広げても背景は 1920×1200 まで同じ色が続く
window_rect = ((200, 120), (800, 618))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
arrange_by = None
label_pos = "bottom"
text_size = 13
icon_size = 80
icon_locations = {
    on_disk("Kikiwake.app"): (230, 80),
    on_disk("アプリケーション"): (570, 80),
    on_disk("設定を開く"): (414, 518),  # 3 の札の真下
    on_disk("はじめに読む.txt"): (84, 518),
    on_disk("Read Me First.txt"): (204, 518),
    # 隠しファイルを表示している人にだけ見える。勝手に置かれて表示がずれないよう、右上の空いた所に置く
    ".background.tiff": (740, 40),
}
