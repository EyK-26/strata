import React, { useContext } from "react";
import Context from "../../context/Context";

const ApplicationDetailHeader = ({ applicant }) => {
    const { state } = useContext(Context);
    return (
        <h2>
            {state.user.role_id === 2
                ? `Dear ${applicant?.first_name}, please find your applications below.`
                : `Dear ${state.user.first_name}, below you can manage the application state.`}
        </h2>
    );
};

export default ApplicationDetailHeader;
