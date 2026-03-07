import UserProfileCard from "../../../components/UserProfileCard";
import UserTimeline from "../../../components/UserTimeline";

export async function getServerSideProps(context) {
  const response = await fetch(`/api/users/${context.params.userId}`);
  const user = await response.json();
  return { props: { user } };
}

export default function UserDetailPage({ user }) {
  return (
    <main>
      <UserProfileCard user={user} />
      <UserTimeline userId={user.id} />
    </main>
  );
}
