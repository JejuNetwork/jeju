import React from "react";

const EthereumIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    fill="#8dadf2" // Adjusted fill for better visibility on typical backgrounds
    width="24px" // Default size, can be overridden by props
    height="24px" // Default size, can be overridden by props
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M15.927 23.959l-9.823-5.797 9.817 13.839 9.828-13.839-9.828 5.797zM16.073 0l-9.819 16.297 9.819 5.807 9.823-5.801z" />
  </svg>
);

export default EthereumIcon;
