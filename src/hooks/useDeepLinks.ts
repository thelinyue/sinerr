interface useDeepLinksProps {
  mediaUrl?: string;
}

const useDeepLinks = ({ mediaUrl }: useDeepLinksProps) => {
  return { mediaUrl };
};

export default useDeepLinks;
