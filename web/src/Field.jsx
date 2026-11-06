// The backdrop of a home-page card: a soft iridescent field with real Pusaka vessels floating in it. Each vessel is a
// live token (its key's tint, its proven BTC as the orange inside), so the picture is the data.
import Emblem from "./Emblem.jsx";

const MESH = {
  sky: "radial-gradient(60% 55% at 15% 10%, #9fd3f7 0%, transparent 70%), radial-gradient(55% 60% at 90% 20%, #d9c6fa 0%, transparent 70%), radial-gradient(70% 60% at 50% 110%, #c6ecda 0%, transparent 70%), #e7f1fb",
  dawn: "radial-gradient(60% 60% at 85% 10%, #fbd3bd 0%, transparent 70%), radial-gradient(60% 60% at 10% 30%, #cdb8f6 0%, transparent 70%), radial-gradient(70% 60% at 60% 110%, #a9dcf3 0%, transparent 70%), #f4ecf6",
  mint: "radial-gradient(60% 60% at 10% 15%, #bfeccf 0%, transparent 70%), radial-gradient(55% 55% at 95% 30%, #a8d4f6 0%, transparent 70%), radial-gradient(70% 60% at 40% 110%, #f6e2a6 0%, transparent 70%), #ecf6f1",
};

/** spots: [{ info, x, y, size, blur }] with x/y as % of the card and size as % of its width */
export default function Field({ mesh = "sky", spots = [] }) {
  return (
    <div className="field" style={{ background: MESH[mesh] }} aria-hidden="true">
      {spots.filter((s) => s.info).map(({ info, x, y, size, blur }) => (
        <div key={info.token.token_id} className={`field-orb${blur ? " field-orb-far" : ""}`} style={{ left: `${x}%`, top: `${y}%`, width: `${size}%` }}>
          <Emblem pubkey={info.btc_pubkey} sats={Number(info.verified_sats)} size="100%" label="" />
        </div>
      ))}
    </div>
  );
}
