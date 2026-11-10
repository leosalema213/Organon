import ShareResources from './ShareResources.jsx';

export default function ShareBook({ book, ...props }) {
  return <ShareResources {...props} module="books" resources={[book]} single />;
}
