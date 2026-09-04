import React, { useContext } from "react";
import Context from "../../../context/Context";

const Hire = ({
    setIsProcessingQuery,
    setIsHirePopupOpen,
    handleMove,
    application,
}) => {
    const { state } = useContext(Context);
    return (
        <div className="Hire">
            <div className="text">
                <span>
                    {`Dear ${state.user.first_name}, You are about to hire ${application.user.first_name} ${application.user.last_name} for the position of ${application.position.name}.
                        By clicking confirm a hiring confirmation email will be sent to applicant.`}
                </span>
            </div>
            <div className="buttons">
                <button
                    onClick={() => {
                        setIsProcessingQuery(true);
                        handleMove();
                    }}
                >
                    Confirm
                </button>
                <button onClick={() => setIsHirePopupOpen(false)}>
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default Hire;
