import { Stub } from '../../_components/Stub';
export default async function ViewerPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <Stub title="Watch" milestone="M7 (playback)">
    <p style={{ color: '#5c6676', fontSize: 13 }}>share id: {shareId}</p>
  </Stub>;
}
