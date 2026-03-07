import { getUserDetail } from "../../../lib/server/user-service";

export default async function handler(req, res) {
  const user = await getUserDetail(req.query.userId);
  return res.status(200).json(user);
}
