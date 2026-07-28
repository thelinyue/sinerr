interface useDeepLinksProps {
  mediaUrl?: string;
  mediaUrl4k?: string;
}

const useDeepLinks = ({ mediaUrl, mediaUrl4k }: useDeepLinksProps) => {
  return { mediaUrl, mediaUrl4k };
};

export default useDeepLinks;
