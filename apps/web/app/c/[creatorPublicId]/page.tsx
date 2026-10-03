import { Stub } from '../../_components/Stub';
export default async function CreatorPage({ params }: { params: Promise<{ creatorPublicId: string }> }) {
  const { creatorPublicId } = await params;
  return <Stub title="Creator" milestone="M7 (public creator page)">
    <p style={{ color: '#5c6676', fontSize: 13 }}>creator: {creatorPublicId}</p>
  </Stub>;
}
