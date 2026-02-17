import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">CollabBoard</h1>
      <p className="text-gray-600 mb-8">Real-time collaborative whiteboard</p>
      <Link
        href="/board/test"
        className="px-6 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
      >
        Go to Board
      </Link>
    </div>
  );
}
