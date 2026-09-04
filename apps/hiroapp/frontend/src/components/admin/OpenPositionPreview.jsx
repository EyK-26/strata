import React from "react";
import { Link } from "react-router-dom";

const OpenPositionPreview = ({ position }) => {
	return (
		<div>
			<Link to={"/positions/" + position.id} className="list-item">
				<span>{position.name}</span>
				<span>({position.applications.length})</span>
			</Link>
			<span>
				Due:
				{position.start_date ? position.start_date : "Not determined"}
			</span>
		</div>
	);
};

export default OpenPositionPreview;
