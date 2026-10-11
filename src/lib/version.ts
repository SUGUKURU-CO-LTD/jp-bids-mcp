// JP Bids MCP の単一バージョン定数。すべてのバージョン参照はここから import する。
// Single source of truth for JP Bids MCP version. All version references must import this.
// Sumber tunggal kebenaran versi JP Bids MCP. Semua referensi versi harus mengimpor dari sini.
//
// このファイルを更新したら package.json と server.json と .well-known/*.json も
// 同じ値に揃える（CI で整合性チェックされる）。
//
// When updating, also synchronize package.json, server.json, and .well-known/*.json
// to the same value (consistency is enforced by CI).
//
// Saat diperbarui, sinkronkan juga package.json, server.json, dan .well-known/*.json
// ke nilai yang sama (konsistensi diberlakukan oleh CI).
export const VERSION = "0.9.0";
