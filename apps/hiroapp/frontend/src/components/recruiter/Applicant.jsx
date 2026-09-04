import React from "react";

const Applicant = ({ user }) => {
    return (
        <li>
            {user?.first_name} {user?.last_name}
        </li>
    );
};

export default Applicant;
