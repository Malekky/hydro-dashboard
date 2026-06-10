export default function Landing() {
  return (
    <main>
      <h1>Subrail</h1>
      <p>Subscribe to Claude from anywhere — no international card needed.</p>
      <ol>
        <li>Pick your country and Claude plan; see the true all-in monthly cost.</li>
        <li>Fund your own wallet with local money via Peer (zkp2p).</li>
        <li>Authorize a capped, revocable renewal agent. Stay subscribed.</li>
      </ol>
      <p>
        Prototype scaffold — see <code>subrail/docs/</code> for the research report, design,
        and spec. Quote API: <code>POST /api/quote</code>.
      </p>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Subrail is not affiliated with Anthropic. Not available in sanctioned or
        Claude-unsupported regions.
      </p>
    </main>
  );
}
